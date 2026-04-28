"""本地视频目录扫描器 — 批量导入已下载视频（内存安全版）"""
import json
import logging
import os
import subprocess
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import List

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.video import Video
from app.schemas.video import ScanLocalResultItem
from app.services.screenshot_service import _build_screenshot_path, _capture_first_second
from app.utils.text import normalize_title, title_to_pinyin

logger = logging.getLogger(__name__)

VIDEO_EXTENSIONS = {'.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm'}
MAX_FFPROBE_TIMEOUT = 30  # ffprobe 硬超时
MAX_VIDEO_SIZE_BYTES = 20 * 1024 * 1024 * 1024  # 跳过 >20GB 的单个文件


def _filename_to_title(filepath: str) -> str:
    """从文件路径提取视频标题"""
    stem = Path(filepath).stem
    import re
    title = re.sub(r'\[.*?\]|【.*?】|\(.*?\)|\{.*?\}', '', stem)
    title = re.sub(
        r'(1080p|720p|4K|2160p|HD|BD|WEB-DL|HDR|x264|x265|HEVC|AVC|AAC|DDP|H\.264|H\.265)',
        '', title, flags=re.IGNORECASE,
    )
    title = re.sub(r'[_\-.]', ' ', title)
    title = re.sub(r'\s+', ' ', title).strip()
    return title[:512] or stem[:512]


def _get_ffprobe_duration(filepath: str) -> tuple[int, str]:
    """
    用 ffprobe 获取视频时长，返回 (秒, 字符串)
    内存安全：ffprobe 只读 metadata header，不加载视频流
    """
    ffprobe = settings.FFMPEG_BIN.replace('ffmpeg', 'ffprobe')
    cmd = [
        ffprobe,
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-read_intervals', '%+#1',  # 只读前 1 秒的 stream 信息
        filepath,
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=MAX_FFPROBE_TIMEOUT,
        )
        if result.returncode != 0:
            return 0, ''
        data = json.loads(result.stdout)
        duration_secs = int(float(data.get('format', {}).get('duration', 0)))
        mins = duration_secs // 60
        secs = duration_secs % 60
        return duration_secs, f'{mins}:{secs:02d}'
    except subprocess.TimeoutExpired:
        logger.warning('ffprobe timeout: %s', filepath)
        return 0, ''
    except (json.JSONDecodeError, KeyError, ValueError):
        return 0, ''


def _is_video_file(filepath: str, allowed_exts: set) -> bool:
    ext = Path(filepath).suffix.lower()
    return ext in allowed_exts


def _walk_video_files(directory: Path, allowed_exts: set, max_files: int) -> List[Path]:
    """
    递归遍历目录收集视频文件（os.walk 是生成器，不爆内存）
    最多收集 max_files 个路径
    """
    files: List[Path] = []
    try:
        for root, _, filenames in os.walk(directory):
            for fname in filenames:
                fpath = Path(root) / fname
                if _is_video_file(str(fpath), allowed_exts):
                    files.append(fpath)
                    if len(files) >= max_files:
                        return files
    except PermissionError as e:
        logger.warning('scan permission denied: %s', e)
    return files


def scan_local_directory(
    db: Session,
    directory: str,
    extensions: list[str],
    max_files: int,
    generate_screenshot: bool,
    dedup_by_path: bool,
    return_items: bool = False,
) -> tuple[List[ScanLocalResultItem], dict]:
    """
    扫描本地目录，提取视频元信息并入库。

    返回 (items_or_empty, summary)
    summary 始终包含统计数字，items 仅在 return_items=True 时返回。
    默认不返回 items 以避免大响应体 OOM。
    """
    results: List[ScanLocalResultItem] = []
    dir_path = Path(directory).expanduser().resolve()

    if not dir_path.exists() or not dir_path.is_dir():
        return results, {'total_found': 0, 'total_new': 0, 'total_skipped_duplicate': 0,
                         'total_skipped_not_video': 0, 'total_error': 0, 'total_oversized': 0}

    allowed_exts = {ext.lower() for ext in extensions} if extensions else VIDEO_EXTENSIONS

    # 1. 收集文件列表（os.walk 生成器，内存安全）
    all_files = _walk_video_files(dir_path, allowed_exts, max_files)

    # 2. 批量查已入库路径
    existing_paths: set[str] = set()
    if dedup_by_path and all_files:
        batch_size = 500
        for i in range(0, len(all_files), batch_size):
            batch = all_files[i:i + batch_size]
            paths_str = [str(p) for p in batch]
            rows = db.query(Video.download_path).filter(
                Video.download_path.in_(paths_str),
                Video.is_deleted == 0,
            ).all()
            existing_paths.update(r.download_path for r in rows)

    # 3. 逐文件处理
    oversized_count = 0
    new_videos: List[Video] = []

    for fpath in all_files:
        path_str = str(fpath)

        # 跳过超大文件
        try:
            fsize = fpath.stat().st_size
        except OSError:
            continue

        if fsize > MAX_VIDEO_SIZE_BYTES:
            oversized_count += 1
            if return_items:
                results.append(ScanLocalResultItem(
                    file_path=path_str, title='', size_mb=Decimal(str(round(fsize / 1048576, 2))),
                    duration_secs=0, duration_str='', download_date=None,
                    status='error', error=f'文件过大 ({round(fsize/1073741824, 1)}GB)，已跳过',
                ))
            continue

        # 去重跳过
        if path_str in existing_paths:
            if return_items:
                results.append(ScanLocalResultItem(
                    file_path=path_str, title='', size_mb=Decimal('0'),
                    duration_secs=0, duration_str='', download_date=None,
                    status='skipped_duplicate',
                ))
            continue

        # 提取元信息
        try:
            stat = fpath.stat()
            size_mb = Decimal(str(round(stat.st_size / 1048576, 2)))
            mtime = datetime.fromtimestamp(stat.st_mtime)
            title = _filename_to_title(path_str)
            duration_secs, duration_str = _get_ffprobe_duration(path_str)

            video = Video(
                url='',
                title=title,
                title_pinyin=title_to_pinyin(title),
                title_normalized=normalize_title(title),
                size_mb=float(size_mb),
                duration_secs=duration_secs,
                duration_str=duration_str or '0:00',
                category='',
                source_site='local',
                download_date=mtime,
                download_path=path_str,
                screenshot_path='',
                is_deleted=0,
            )
            db.add(video)
            db.flush()
            new_videos.append(video)

            if return_items:
                results.append(ScanLocalResultItem(
                    file_path=path_str, title=title, size_mb=size_mb,
                    duration_secs=duration_secs, duration_str=duration_str or '0:00',
                    download_date=mtime, status='new',
                ))

        except Exception as e:
            logger.error('scan file error: %s - %s', path_str, e)
            if return_items:
                results.append(ScanLocalResultItem(
                    file_path=path_str, title='', size_mb=Decimal('0'),
                    duration_secs=0, duration_str='', download_date=None,
                    status='error', error=str(e)[:500],
                ))

    # 4. 提交数据库
    db.commit()

    # 5. 批量截图（按需）
    if generate_screenshot and new_videos:
        for video in new_videos:
            try:
                screenshot_path = _build_screenshot_path(video.id)
                ok, _ = _capture_first_second(video.download_path, screenshot_path)
                if ok:
                    video.screenshot_path = screenshot_path
            except Exception as e:
                logger.warning('screenshot failed during scan: %s - %s', video.download_path, e)
        db.commit()

    # 6. 统计
    total_new = sum(1 for r in results if r.status == 'new') if return_items else len(new_videos)
    total_skipped_dup = sum(1 for r in results if r.status == 'skipped_duplicate') if return_items else (len(all_files) - len(new_videos) - oversized_count)
    total_error = sum(1 for r in results if r.status == 'error') if return_items else 0

    summary = {
        'total_found': len(all_files),
        'total_new': total_new,
        'total_skipped_duplicate': total_skipped_dup,
        'total_skipped_not_video': 0,
        'total_error': total_error,
        'total_oversized': oversized_count,
    }

    return results, summary
