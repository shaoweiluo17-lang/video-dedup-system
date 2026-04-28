from datetime import datetime

from sqlalchemy import String, BigInteger, DateTime, Text, ForeignKey, func, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class DownloadHistory(Base):
    __tablename__ = 'download_history'
    __table_args__ = (
        Index('idx_download_history_video_id', 'video_id'),
        Index('idx_download_history_status', 'status'),
        Index('idx_download_history_created_at', 'created_at'),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    video_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey('videos.id'), nullable=True)
    url: Mapped[str] = mapped_column(String(2048), default='')
    download_path: Mapped[str] = mapped_column(String(1024), default='')
    status: Mapped[str] = mapped_column(String(20), default='pending')
    error_message: Mapped[str] = mapped_column(Text, default='')
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
