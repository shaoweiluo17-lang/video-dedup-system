import hashlib
import re
from urllib.parse import urlparse

from pypinyin import lazy_pinyin


def normalize_title(title: str) -> str:
    """归一化标题：去标点符号空格，转小写，只保留字母数字和中文"""
    s = (title or '').strip().lower()
    # 去掉所有非字母数字非中文的字符（空格、-、.、_、| 等）
    s = re.sub(r'[^a-z0-9\u4e00-\u9fff]', '', s)
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
