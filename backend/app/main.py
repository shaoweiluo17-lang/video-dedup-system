import logging
import os
from pathlib import Path

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import settings
from app.db.session import Base, engine
from app.services.scheduler import start_scheduler, stop_scheduler

logging.basicConfig(level=logging.INFO)

# 自动建表
Base.metadata.create_all(bind=engine)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title=settings.APP_NAME, lifespan=lifespan)
app.include_router(api_router)

# 截图/预览图静态文件服务
screenshot_dir = Path(settings.SCREENSHOT_DIR)
screenshot_dir.mkdir(parents=True, exist_ok=True)
app.mount('/screenshots', StaticFiles(directory=str(screenshot_dir)), name='screenshots')
