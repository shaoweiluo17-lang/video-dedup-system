import logging
import os
import subprocess
from pathlib import Path

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.video import Video
from app.schemas.video import ScreenshotTaskResponse

logger = logging.getLogger(__name__)

# === 内存安全配置 ===
MAX_VIDEO_SIZE_BYTES = 20 * 1024 * 1024 * 1024   # 跳过 >20GB 文件
FFMPEG_TIMEOUT = 60                                # FFmpeg 硬超时
MAX_RETRIES = 3                                    # 单文件最大重试次数


def _build_screenshot_path(video_id: int) -> str:
    base_dir = Path(settings.SCREENSHOT_DIR)
    base_dir.mkdir(parents=True, exist_ok=True)
    return str(base_dir / f"video_{video_id}.jpg")


def _capture_first_second(video_path: str, screenshot_path: str) -> tuple[bool, str]:
    """
    截取视频第1秒作为预览图。
    内存安全：
    - `-frames:v 1` 只解码1帧
    - `-ss 1` 在前跳过不需要渲染前面的帧
    - `-an` 不处理音频流
    - 硬超时保护
    """
    if not video_path:
        return False, 'download_path is empty'

    # === 文件大小检查 ===
    try:
        fsize = os.path.getsize(video_path)
        if fsize > MAX_VIDEO_SIZE_BYTES:
            return False, f'file too large ({round(fsize/1073741824, 1)}GB), skipped'
    except OSError as e:
        return False, f'cannot stat file: {e}'

    if not os.path.exists(video_path):
        return False, f'video file not found: {video_path}'

    cmd = [
        settings.FFMPEG_BIN,
        '-y',
        '-ss', '00:00:01',       # seek 到第1秒
        '-i', video_path,
        '-frames:v', '1',        # 只取1帧，不会加载整个视频
        '-an',                    # 跳过音频流
        '-q:v', str(settings.SCREENSHOT_QUALITY),
        '-threads', '1',          # 单线程，限制内存
        screenshot_path,
    ]

    try:
        subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            timeout=FFMPEG_TIMEOUT,
        )
        return True, ''
    except subprocess.CalledProcessError as e:
        err = (e.stderr or e.stdout or str(e))[:500]
        logger.warning('ffmpeg failed for %s: %s', video_path, err)
        return False, err
    except subprocess.TimeoutExpired:
        return False, f'ffmpeg timeout after {FFMPEG_TIMEOUT}s'


def process_pending_screenshots(db: Session, limit: int) -> ScreenshotTaskResponse:
    """
    处理一批待截图视频。
    串行逐个处理，每个文件最多重试 MAX_RETRIES 次。
    """
    records = (
        db.query(Video)
        .filter(
            Video.is_deleted == 0,
            or_(Video.screenshot_path == '', Video.screenshot_path.is_(None)),
        )
        .order_by(Video.id.asc())
        .limit(limit)
        .all()
    )

    success = 0
    failed = 0
    skipped = 0

    for video in records:
        if not video.download_path:
            skipped += 1
            continue

        screenshot_path = _build_screenshot_path(video.id)

        ok = False
        err = ''
        for attempt in range(1, MAX_RETRIES + 1):
            ok, err = _capture_first_second(video.download_path, screenshot_path)
            if ok:
                break
            logger.debug('screenshot retry %d/%d for video_id=%d: %s',
                         attempt, MAX_RETRIES, video.id, err)

        if ok:
            video.screenshot_path = screenshot_path
            success += 1
        else:
            failed += 1

    db.commit()

    if success or failed or skipped:
        logger.info('screenshot batch done: total=%d success=%d failed=%d skipped=%d',
                    len(records), success, failed, skipped)

    return ScreenshotTaskResponse(processed=len(records), success=success, failed=failed)
