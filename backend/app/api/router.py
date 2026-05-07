from fastapi import APIRouter

from app.api.v1.health import router as health_router
from app.api.v1.public import router as public_router
from app.api.v1.videos import router as videos_router
from app.api.v1.utils import router as utils_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(public_router)
api_router.include_router(utils_router)
api_router.include_router(videos_router)
