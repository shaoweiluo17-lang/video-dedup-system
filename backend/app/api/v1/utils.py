"""工具接口：文件大小检测等"""
import os

from fastapi import APIRouter, Query

router = APIRouter()


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
