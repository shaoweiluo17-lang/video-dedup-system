import json
import logging
import os
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import requests
from redis import Redis
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.video import Video
from app.models.download_history import DownloadHistory
from app.schemas.video import (
    VideoCreateRequest,
    VideoImportItem,
    CheckResponseItem,
    VideoCheckResponse,
)
from app.utils.text import normalize_title, title_to_pinyin, parse_source_site, hash_text

logger = logging.getLogger(__name__)


def _decimal_to_float(v: Decimal | float | int) -> float:
    return float(v or 0)


def _to_check_item(video: Video, score: float) -> CheckResponseItem:
    return CheckResponseItem(
        id=video.id,
        title=video.title,
        duration_secs=video.duration_secs,
        size_mb=Decimal(str(video.size_mb or 0)),
        download_path=video.download_path,
        preview_path=video.preview_path or '',
        screenshot_path=video.screenshot_path or '',
        source_site=video.source_site,
        score=round(score, 2),
    )


def check_duplicate(
    db: Session,
    redis_client: Redis,
    title: str,
    duration_secs: int,
    size_mb: Decimal,
    source_site: str = '',
) -> VideoCheckResponse:
    normalized = normalize_title(title)
    pinyin = title_to_pinyin(title)
    final_source_site = source_site or ''

    cache_key_raw = f"{normalized}|{duration_secs}|{size_mb}|{final_source_site}"
    cache_key = f"video:check:{hash_text(cache_key_raw)}"
    cached = redis_client.get(cache_key)
    if cached:
        data = json.loads(cached)
        return VideoCheckResponse(**data)

    query = db.query(Video).filter(Video.is_deleted == 0)
    if final_source_site:
        query = query.filter(Video.source_site == final_source_site)

    candidates = query.filter(
        or_(
            Video.title_normalized == normalized,
            Video.title_pinyin == pinyin,
            Video.title.like(f"%{title}%"),
        )
    ).limit(30).all()

    strong_matches: list[CheckResponseItem] = []
    medium_matches: list[CheckResponseItem] = []
    weak_matches: list[CheckResponseItem] = []

    target_size = _decimal_to_float(size_mb)
    for v in candidates:
        dur_diff = abs((v.duration_secs or 0) - (duration_secs or 0))
        v_size = _decimal_to_float(v.size_mb)
        size_diff_pct = abs(v_size - target_size) / target_size if target_size > 0 else 0

        if v.title_normalized == normalized and dur_diff <= 3:
            strong_matches.append(_to_check_item(v, 0.98))
        elif v.title_pinyin == pinyin and dur_diff <= 5 and size_diff_pct <= 0.05:
            medium_matches.append(_to_check_item(v, 0.85))
        elif title and title in (v.title or ''):
            weak_matches.append(_to_check_item(v, 0.60))

    if strong_matches:
        result = VideoCheckResponse(exists=True, level='strong', matches=strong_matches)
    elif medium_matches:
        result = VideoCheckResponse(exists=True, level='medium', matches=medium_matches)
    elif weak_matches:
        result = VideoCheckResponse(exists=True, level='weak', matches=weak_matches)
    else:
        result = VideoCheckResponse(exists=False, level='none', matches=[])
        # 不缓存"无重复"结果，避免添加后缓存未失效导致重复添加
        return result

    redis_client.setex(cache_key, settings.CHECK_CACHE_TTL_SECONDS, result.model_dump_json())
    return result


def _download_preview(preview_url: str, video_id: int) -> str:
    """下载 preview.jpg 并保存到截图目录，返回本地路径"""
    if not preview_url:
        return ''
    try:
        url = preview_url.strip()
        if url.startswith('//'):
            url = 'https:' + url
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()

        base_dir = Path(settings.SCREENSHOT_DIR)
        base_dir.mkdir(parents=True, exist_ok=True)

        # 从 URL 推断扩展名，默认 .jpg
        parsed = urlparse(url)
        ext = Path(parsed.path).suffix or '.jpg'
        if ext.lower() not in ('.jpg', '.jpeg', '.png', '.webp'):
            ext = '.jpg'

        dest = base_dir / f"video_{video_id}_preview{ext}"
        dest.write_bytes(resp.content)
        logger.info("preview downloaded: %s → %s", url, dest)
        return str(dest)
    except Exception as exc:
        logger.warning("preview download failed for %s: %s", preview_url, exc)
        return ''


def create_video(db: Session, payload: VideoCreateRequest) -> Video:
    site = payload.source_site or parse_source_site(payload.url)
    video = Video(
        url=payload.url,
        title=payload.title,
        title_pinyin=title_to_pinyin(payload.title),
        title_normalized=normalize_title(payload.title),
        size_mb=payload.size_mb,
        duration_secs=payload.duration_secs,
        duration_str=payload.duration_str,
        category=payload.category,
        source_site=site,
        download_date=payload.download_date or datetime.now(),
        download_path=payload.download_path,
        screenshot_path='',
    )
    db.add(video)
    db.flush()

    # 下载预览图
    if payload.preview_url:
        preview_path = _download_preview(payload.preview_url, video.id)
        if preview_path:
            video.preview_path = preview_path

    history = DownloadHistory(
        video_id=video.id,
        url=payload.url,
        download_path=payload.download_path,
        status='completed',
        error_message='',
    )
    db.add(history)
    db.commit()
    db.refresh(video)
    return video


def import_video_item(db: Session, item: VideoImportItem) -> tuple[bool, Optional[Video]]:
    duplicate = (
        db.query(Video)
        .filter(
            Video.is_deleted == 0,
            Video.title_normalized == normalize_title(item.title),
            Video.duration_secs == item.duration_secs,
        )
        .first()
    )
    if duplicate:
        return False, duplicate

    payload = VideoCreateRequest(**item.model_dump())
    video = create_video(db, payload)
    return True, video


def get_stats(db: Session) -> dict:
    row = db.query(
        func.count(Video.id),
        func.coalesce(func.sum(Video.size_mb), 0),
        func.coalesce(func.sum(Video.duration_secs), 0),
    ).filter(Video.is_deleted == 0).one()

    pending = db.query(func.count(Video.id)).filter(
        Video.is_deleted == 0,
        or_(Video.screenshot_path == '', Video.screenshot_path.is_(None)),
    ).scalar() or 0

    return {
        'total_videos': int(row[0] or 0),
        'total_size_mb': Decimal(str(row[1] or 0)),
        'total_duration_secs': int(row[2] or 0),
        'pending_screenshot': int(pending),
    }
