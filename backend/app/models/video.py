from datetime import datetime

from sqlalchemy import String, Integer, BigInteger, DECIMAL, DateTime, func, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Video(Base):
    __tablename__ = 'videos'
    __table_args__ = (
        Index('idx_videos_url', 'url'),
        Index('idx_videos_title', 'title'),
        Index('idx_videos_title_normalized', 'title_normalized'),
        Index('idx_videos_title_pinyin', 'title_pinyin'),
        Index('idx_videos_duration', 'duration_secs'),
        Index('idx_videos_source_site', 'source_site'),
        Index('idx_videos_download_date', 'download_date'),
        Index('idx_videos_created_at', 'created_at'),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    url: Mapped[str] = mapped_column(String(2048), default='')
    title: Mapped[str] = mapped_column(String(512), default='')
    title_pinyin: Mapped[str] = mapped_column(String(512), default='')
    title_normalized: Mapped[str] = mapped_column(String(512), default='')
    size_mb: Mapped[float] = mapped_column(DECIMAL(10, 2), default=0)
    duration_secs: Mapped[int] = mapped_column(Integer, default=0)
    duration_str: Mapped[str] = mapped_column(String(20), default='')
    category: Mapped[str] = mapped_column(String(50), default='')
    source_site: Mapped[str] = mapped_column(String(100), default='')
    download_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    download_path: Mapped[str] = mapped_column(String(1024), default='')
    screenshot_path: Mapped[str] = mapped_column(String(512), default='')
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    is_deleted: Mapped[int] = mapped_column(Integer, default=0)
