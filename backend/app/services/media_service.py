import hashlib
import os
import subprocess
from datetime import datetime

from app.core.config import settings


def make_video_hash(source_url: str, title: str = '') -> str:
    raw = f"{source_url}|{title}".encode('utf-8')
    return hashlib.sha256(raw).hexdigest()


def build_download_path(title: str, ext: str = 'mp4') -> str:
    day = datetime.now().strftime('%Y-%m-%d')
    safe_title = ''.join(ch for ch in title if ch.isalnum() or ch in ('-', '_', ' ')).strip() or 'untitled'
    safe_title = safe_title[:80]
    return os.path.join(settings.NAS_ROOT, day, f"{safe_title}.{ext}")


def take_screenshot(video_path: str, output_path: str) -> bool:
    cmd = [
        settings.FFMPEG_BIN,
        '-y',
        '-ss', '00:00:02',
        '-i', video_path,
        '-frames:v', '1',
        output_path,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        return True
    except Exception:
        return False


def trigger_idm_download(url: str, save_path: str) -> dict:
    # Phase 1: mock; Phase 2: 调用 IDM CLI
    return {
        'task_id': f'mock-{abs(hash(url))}',
        'status': 'queued',
        'message': f'queued to {save_path}',
    }
