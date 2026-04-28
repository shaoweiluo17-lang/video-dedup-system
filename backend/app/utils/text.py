import hashlib
import re
from urllib.parse import urlparse

from pypinyin import lazy_pinyin


def normalize_title(title: str) -> str:
    s = (title or '').strip().lower()
    s = re.sub(r'\s+', ' ', s)
    return s


def title_to_pinyin(title: str) -> str:
    if not title:
        return ''
    return ''.join(lazy_pinyin(title)).lower()


def hash_text(value: str) -> str:
    return hashlib.md5((value or '').encode('utf-8')).hexdigest()


def parse_source_site(url: str) -> str:
    try:
        return urlparse(url).netloc.lower()
    except Exception:
        return ''
