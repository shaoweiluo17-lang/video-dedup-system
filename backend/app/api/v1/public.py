# public.py — 无需 API Key 的公共端点
from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.video import Video

router = APIRouter(prefix='/api/v1/public', tags=['public'])


@router.get('/lookup')
def lookup_by_url(
    url: str = Query(..., description='页面完整 URL'),
    db: Session = Depends(get_db),
):
    """轻量 URL-only 查询，无需 API Key。
    
    供 checker 浏览器插件使用，仅通过 URL 判断视频是否存在。
    """
    url_clean = url.rstrip('/')
    url_base = url_clean.split('?')[0]

    record = db.query(Video).filter(
        Video.is_deleted == 0,
        or_(
            Video.url == url,
            Video.url == url_clean,
            Video.url.like(f"{url_base}%"),
        )
    ).first()

    if record:
        return {
            'exists': True,
            'id': record.id,
            'title': record.title,
            'screenshot_path': record.screenshot_path or '',
        }
    return {
        'exists': False,
        'id': None,
        'title': '',
        'screenshot_path': '',
    }


@router.post('/lookup-batch')
def lookup_batch(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    """批量 URL 查询，供右键扫描插件使用。
    
    最多处理 200 个 URL，先精确匹配后降噪匹配。
    """
    urls = (payload.get('urls') or [])[:200]

    # Step 1: 精确匹配（批量 IN 查询）
    exact_records = db.query(Video).filter(
        Video.is_deleted == 0,
        Video.url.in_(urls),
    ).all()
    exact_map = {r.url: r for r in exact_records}

    results = {}
    for url in urls:
        if url in exact_map:
            r = exact_map[url]
            results[url] = {'exists': True, 'id': r.id}
        else:
            # Step 2: 降噪匹配（去尾部斜杠、去查询参数）
            url_clean = url.rstrip('/')
            url_base = url_clean.split('?')[0]
            record = db.query(Video).filter(
                Video.is_deleted == 0,
                or_(
                    Video.url == url_clean,
                    Video.url.like(f"{url_base}%"),
                ),
            ).first()
            if record:
                results[url] = {'exists': True, 'id': record.id}
            else:
                results[url] = {'exists': False, 'id': None}

    return {'results': results}
