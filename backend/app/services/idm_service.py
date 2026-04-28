"""
IDM 下载服务 — 通过命令行桥接调用 IDM
"""
import hashlib
import logging
import platform
import subprocess
import uuid

from app.core.config import settings

logger = logging.getLogger(__name__)

IS_WINDOWS = platform.system() == 'Windows'


def _safe_filename(title: str) -> str:
    """从标题生成安全文件名"""
    safe = ''.join(ch for ch in title if ch.isalnum() or ch in (' ', '-', '_', '.')).strip()
    return safe[:80] or 'untitled'


def queue_download(url: str, title: str, suffix: str = '') -> dict:
    """
    将下载任务加入队列（调用 IDM CLI）
    返回任务元信息
    """
    task_id = hashlib.md5(f'{url}|{title}|{uuid.uuid4()}'.encode()).hexdigest()[:12]

    name = _safe_filename(title)
    if suffix:
        name = f'{name}_{suffix}'

    result = {
        'task_id': task_id,
        'url': url,
        'file_name': f'{name}.mp4',
        'status': 'queued',
    }

    if IS_WINDOWS and settings.IDM_EXE:
        try:
            cmd = [
                settings.IDM_EXE,
                '/d', url,
                '/p', settings.DOWNLOAD_ROOT,
                '/f', f'{name}.mp4',
                '/n', '/q',
            ]
            proc = subprocess.Popen(cmd, shell=True)
            result['pid'] = proc.pid
            result['status'] = 'downloading'
            logger.info('IDM download started: task_id=%s pid=%d', task_id, proc.pid)
        except Exception as e:
            result['status'] = 'failed'
            result['error'] = str(e)
            logger.error('IDM launch failed: %s', e)
    else:
        result['status'] = 'mock'
        result['message'] = '非 Windows 环境，跳过 IDM 调用'

    return result
