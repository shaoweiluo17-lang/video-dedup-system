import json
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import verify_api_key
from app.core.config import settings
from app.core.redis_client import get_redis_client
from app.db.session import get_db
from app.models.video import Video
from app.schemas.video import (
    VideoCheckResponse,
    VideoCreateRequest,
    VideoImportRequest,
    VideoImportResponse,
    VideoListResponse,
    VideoOut,
    VideoStatsResponse,
    VideoUpdateScreenshotRequest,
    VideoUpdateRequest,
    ScreenshotTaskRequest,
    ScreenshotTaskResponse,
    ScanLocalRequest,
    ScanLocalResponse,
)
from app.services.video_service import (
    check_duplicate,
    create_video,
    get_stats,
    import_video_item,
    update_video as update_video_service,
)
from app.services.screenshot_service import process_pending_screenshots
from app.services.scanner_service import scan_local_directory
from app.utils.text import hash_text

router = APIRouter(prefix='/api/v1/videos', tags=['videos'], dependencies=[Depends(verify_api_key)])


@router.get('/search', response_model=VideoListResponse)
def search_videos(
    query: str = Query(default=''),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    redis_client = get_redis_client()
    cache_key = f"video:search:{hash_text(f'{query}:{page}:{page_size}')}"
    cached = redis_client.get(cache_key)
    if cached:
        data = json.loads(cached)
        return VideoListResponse(**data)

    base_query = db.query(Video).filter(Video.is_deleted == 0)
    if query:
        like = f"%{query}%"
        base_query = base_query.filter(
            or_(
                Video.title.like(like),
                Video.title_pinyin.like(like),
                Video.title_normalized.like(like),
                Video.url.like(like),
            )
        )

    total = base_query.count()
    records = (
        base_query.order_by(Video.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    result = VideoListResponse(total=total, items=[VideoOut.model_validate(r) for r in records])
    redis_client.setex(cache_key, settings.SEARCH_CACHE_TTL_SECONDS, result.model_dump_json())
    return result


@router.get('/check', response_model=VideoCheckResponse)
def check_video_exists(
    title: str = Query(...),
    duration_secs: int = Query(default=0, ge=0),
    size_mb: Decimal = Query(default=Decimal('0')),
    source_site: str = Query(default=''),
    url: str = Query(default=''),
    db: Session = Depends(get_db),
):
    import logging
    logging.getLogger(__name__).info("check url=%r title=%r dur=%d", url, title, duration_secs)
    result = check_duplicate(db, title, url, duration_secs, size_mb, source_site)
    logging.getLogger(__name__).info("check result exists=%s level=%s matches=%d", result.exists, result.level, len(result.matches or []))
    return result


@router.post('', response_model=VideoOut)
def add_video(payload: VideoCreateRequest, db: Session = Depends(get_db)):
    video = create_video(db, payload)
    redis_client = get_redis_client()
    redis_client.lpush('video:pending_screenshot', video.id)
    redis_client.delete('video:stats')
    return VideoOut.model_validate(video)


@router.get('', response_model=VideoListResponse)
def list_videos(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    base_query = db.query(Video).filter(Video.is_deleted == 0)
    total = base_query.count()
    records = (
        base_query.order_by(Video.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return VideoListResponse(total=total, items=[VideoOut.model_validate(r) for r in records])


@router.get('/stats', response_model=VideoStatsResponse)
def video_stats(db: Session = Depends(get_db)):
    redis_client = get_redis_client()
    cached = redis_client.get('video:stats')
    if cached:
        data = json.loads(cached)
        return VideoStatsResponse(**data)

    data = get_stats(db)
    resp = VideoStatsResponse(**data)
    redis_client.setex('video:stats', settings.STATS_CACHE_TTL_SECONDS, resp.model_dump_json())
    return resp


@router.get('/{video_id}', response_model=VideoOut)
def get_video(video_id: int, db: Session = Depends(get_db)):
    record = db.query(Video).filter(Video.id == video_id, Video.is_deleted == 0).first()
    if not record:
        raise HTTPException(status_code=404, detail='Video not found')
    return VideoOut.model_validate(record)


@router.delete('/{video_id}')
def delete_video(video_id: int, db: Session = Depends(get_db)):
    record = db.query(Video).filter(Video.id == video_id, Video.is_deleted == 0).first()
    if not record:
        raise HTTPException(status_code=404, detail='Video not found')
    record.is_deleted = 1
    db.commit()
    get_redis_client().delete('video:stats')
    return {'success': True}


@router.put('/{video_id}/screenshot', response_model=VideoOut)
def update_screenshot(video_id: int, payload: VideoUpdateScreenshotRequest, db: Session = Depends(get_db)):
    record = db.query(Video).filter(Video.id == video_id, Video.is_deleted == 0).first()
    if not record:
        raise HTTPException(status_code=404, detail='Video not found')
    record.screenshot_path = payload.screenshot_path
    db.commit()
    db.refresh(record)
    get_redis_client().delete('video:stats')
    return VideoOut.model_validate(record)


@router.patch('/{video_id}', response_model=VideoOut)
def update_video(video_id: int, payload: VideoUpdateRequest, db: Session = Depends(get_db)):
    video = update_video_service(db, video_id, payload)
    if not video:
        raise HTTPException(status_code=404, detail='Video not found')
    get_redis_client().delete('video:stats')
    return VideoOut.model_validate(video)


@router.post('/import', response_model=VideoImportResponse)
def import_videos(payload: VideoImportRequest, db: Session = Depends(get_db)):
    success_count = 0
    duplicate_count = 0
    fail_count = 0
    new_ids = []

    for item in payload.items:
        try:
            ok, video = import_video_item(db, item)
            if ok:
                success_count += 1
                new_ids.append(video.id)
            else:
                duplicate_count += 1
        except Exception:
            fail_count += 1

    # 新导入的视频推入截图队列
    redis_client = get_redis_client()
    if new_ids:
        redis_client.lpush('video:pending_screenshot', *new_ids)

    redis_client.delete('video:stats')
    return VideoImportResponse(
        success_count=success_count,
        duplicate_count=duplicate_count,
        fail_count=fail_count,
    )


@router.get('/screenshot/pending', response_model=VideoListResponse)
def pending_screenshot_list(
    limit: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db),
):
    records = (
        db.query(Video)
        .filter(Video.is_deleted == 0, or_(Video.screenshot_path == '', Video.screenshot_path.is_(None)))
        .order_by(Video.id.asc())
        .limit(limit)
        .all()
    )
    return VideoListResponse(total=len(records), items=[VideoOut.model_validate(r) for r in records])


@router.post('/screenshot/process', response_model=ScreenshotTaskResponse)
def process_screenshot_task(payload: ScreenshotTaskRequest, db: Session = Depends(get_db)):
    return process_pending_screenshots(db=db, limit=payload.limit)


@router.post('/scan-local', response_model=ScanLocalResponse)
def scan_local(payload: ScanLocalRequest, db: Session = Depends(get_db)):
    """扫描本地视频目录，批量导入已下载的视频（默认仅返回统计摘要，防止 OOM）"""
    items, summary = scan_local_directory(
        db=db,
        directory=payload.directory,
        extensions=payload.extensions,
        max_files=payload.max_files,
        generate_screenshot=payload.generate_screenshot,
        dedup_by_path=payload.dedup_by_path,
        return_items=payload.return_items,
    )

    get_redis_client().delete('video:stats')
    return ScanLocalResponse(items=items, **summary)
