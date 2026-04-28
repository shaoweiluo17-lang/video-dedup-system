from datetime import datetime
from decimal import Decimal
from typing import Optional, List

from pydantic import BaseModel, Field


class CheckResponseItem(BaseModel):
    id: int
    title: str
    duration_secs: int
    size_mb: Decimal
    download_path: str
    source_site: str
    score: float


class VideoCheckResponse(BaseModel):
    exists: bool
    level: str
    matches: List[CheckResponseItem] = Field(default_factory=list)


class VideoCreateRequest(BaseModel):
    url: str
    title: str
    size_mb: Decimal = Decimal('0')
    duration_secs: int = 0
    duration_str: str = ''
    category: str = ''
    source_site: str = ''
    download_date: Optional[datetime] = None
    download_path: str = ''


class VideoOut(BaseModel):
    id: int
    url: str
    title: str
    title_pinyin: str
    title_normalized: str
    size_mb: Decimal
    duration_secs: int
    duration_str: str
    category: str
    source_site: str
    download_date: Optional[datetime]
    download_path: str
    screenshot_path: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class VideoListResponse(BaseModel):
    total: int
    items: List[VideoOut]


class VideoStatsResponse(BaseModel):
    total_videos: int
    total_size_mb: Decimal
    total_duration_secs: int
    pending_screenshot: int


class VideoUpdateScreenshotRequest(BaseModel):
    screenshot_path: str


class VideoImportItem(BaseModel):
    url: str
    title: str
    size_mb: Decimal = Decimal('0')
    duration_secs: int = 0
    duration_str: str = ''
    category: str = ''
    source_site: str = ''
    download_date: Optional[datetime] = None
    download_path: str = ''


class VideoImportRequest(BaseModel):
    items: List[VideoImportItem]


class VideoImportResponse(BaseModel):
    success_count: int
    duplicate_count: int
    fail_count: int


class ScreenshotTaskRequest(BaseModel):
    limit: int = 20


class ScreenshotTaskResponse(BaseModel):
    processed: int
    success: int
    failed: int


class ScanLocalRequest(BaseModel):
    directory: str = Field(..., description='本地视频目录绝对路径')
    extensions: List[str] = Field(default=['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm'], description='扫描的文件扩展名')
    max_files: int = Field(default=500, ge=1, le=10000, description='最大扫描文件数')
    generate_screenshot: bool = Field(default=True, description='是否自动生成截图')
    dedup_by_path: bool = Field(default=True, description='是否按 download_path 去重跳过已入库文件')
    return_items: bool = Field(default=False, description='是否返回逐文件详情（文件量大时建议 false 防 OOM）')


class ScanLocalResultItem(BaseModel):
    file_path: str
    title: str
    size_mb: Decimal
    duration_secs: int
    duration_str: str
    download_date: Optional[datetime]
    status: str  # 'new' / 'skipped_duplicate' / 'skipped_not_video' / 'error'
    error: str = ''


class ScanLocalResponse(BaseModel):
    total_found: int
    total_new: int
    total_skipped_duplicate: int
    total_skipped_not_video: int
    total_error: int
    total_oversized: int
    items: List[ScanLocalResultItem] = Field(default_factory=list)
