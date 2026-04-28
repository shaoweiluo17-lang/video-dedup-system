"""后台定时任务调度器"""
import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.services.screenshot_service import process_pending_screenshots

logger = logging.getLogger(__name__)

_scheduler: BackgroundScheduler | None = None


def _tick_screenshot():
    """每个周期处理一批待截图视频"""
    db = SessionLocal()
    try:
        result = process_pending_screenshots(db=db, limit=settings.SCREENSHOT_BATCH_SIZE)
        if result.processed > 0:
            logger.info(
                "screenshot_tick processed=%d success=%d failed=%d",
                result.processed,
                result.success,
                result.failed,
            )
    except Exception:
        logger.exception("screenshot_tick error")
    finally:
        db.close()


def start_scheduler():
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = BackgroundScheduler(timezone="Asia/Shanghai")
    _scheduler.add_job(
        _tick_screenshot,
        trigger=IntervalTrigger(minutes=settings.SCREENSHOT_INTERVAL_MINUTES),
        id="screenshot_tick",
        name="screenshot_tick",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info("scheduler started")


def stop_scheduler():
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("scheduler stopped")
