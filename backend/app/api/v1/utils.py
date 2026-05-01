"""工具接口：文件大小检测、目录扫描等"""
import os
import re
from pathlib import Path

from fastapi import APIRouter, Query

router = APIRouter(prefix='/api/v1/utils', tags=['utils'])

VIDEO_EXTENSIONS = {'.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.mpg', '.mpeg', '.3gp'}


@router.get('/file-info', summary='获取文件信息')
async def file_info(path: str = Query(..., description='文件的绝对路径')):
    """根据本地路径读取文件大小，用于插件自动填充 size_mb"""
    if not os.path.isfile(path):
        return {'exists': False, 'size_mb': 0, 'name': ''}
    stat = os.stat(path)
    return {
        'exists': True,
        'size_bytes': stat.st_size,
        'size_mb': round(stat.st_size / (1024 * 1024), 2),
        'name': os.path.basename(path),
    }


@router.get('/scan-dir', summary='扫描目录中的视频文件')
async def scan_dir(path: str = Query(..., description='目录的绝对路径')):
    """扫描指定目录，返回所有视频文件列表（用于批量导入）"""
    dir_path = Path(path)
    if not dir_path.is_dir():
        return {'error': '目录不存在', 'files': []}

    files = []
    for f in sorted(dir_path.iterdir()):
        if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS:
            stat = f.stat()
            # 从文件名提取标题（去掉扩展名和常见下载标记）
            title = re.sub(r'\s*[\[\(]?(?:720p|1080p|HD|4K|下载|在线)[\]\)]?\s*', '', f.stem).strip()
            files.append({
                'filename': f.name,
                'title': title,
                'path': str(f),
                'size_mb': round(stat.st_size / (1024 * 1024), 2),
                'size_bytes': stat.st_size,
            })

    return {'count': len(files), 'files': files}
