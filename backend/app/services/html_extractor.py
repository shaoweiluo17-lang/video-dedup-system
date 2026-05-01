"""
HTML Video Page Extractor

从视频网页 HTML 中提取结构化信息：
- 标题 (title)
- 预览图 URL (preview_url)
- 视频时长 (duration)
- 页面完整 URL (page_url)
- video_id

支持扩展的规则引擎（see extraction_rules.json）。
"""

from __future__ import annotations

import re
import json
import logging
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional
from urllib.parse import unquote, urlparse

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class VideoPageMeta:
    """从视频页面提取的元数据"""
    title: str = ""
    preview_url: str = ""
    preview_local_path: Optional[str] = None
    duration: str = ""          # 如 "27:52"
    duration_secs: int = 0      # 转换为秒
    page_url: str = ""
    video_id: str = ""
    categories: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    author: str = ""
    rating: float = 0.0
    views: int = 0
    mp4_url: str = ""
    raw: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Built-in extractors (rule-independent baseline)
# ---------------------------------------------------------------------------

def _ensure_https(url: str) -> str:
    """协议相对 URL → 完整的 https URL"""
    url = url.strip()
    if url.startswith("//"):
        return "https:" + url
    return url


def _parse_duration_secs(duration: str) -> int:
    """'27:52' 或 '1:02:30' → 秒数"""
    duration = duration.strip()
    parts = list(map(int, duration.split(":")))
    if len(parts) == 2:          # MM:SS
        return parts[0] * 60 + parts[1]
    elif len(parts) == 3:        # HH:MM:SS
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    return 0


def extract_meta(html: str, download_preview: bool = False,
                 download_dir: Optional[str] = None) -> VideoPageMeta:
    """
    从 HTML 字符串中提取 VideoPageMeta。

    Args:
        html: 视频页 HTML 源码
        download_preview: 是否下载 preview.jpg 到本地
        download_dir: 下载目标目录，默认当前目录
    """
    soup = BeautifulSoup(html, "html.parser")
    meta = VideoPageMeta()

    # --- title ---
    h1 = soup.select_one(".headline h1")
    if h1:
        meta.title = h1.get_text(strip=True)

    # --- preview_url ---
    img = soup.select_one('.video-holder img[src*="preview"]')
    if img:
        meta.preview_url = _ensure_https(img.get("src", ""))

    # fallback: flashvars
    if not meta.preview_url:
        for script in soup.find_all("script"):
            text = script.string or ""
            m = re.search(r"preview_url\s*:\s*'([^']+)'", text)
            if m:
                meta.preview_url = _ensure_https(m.group(1))
                break

    # --- duration ---
    dur_el = soup.select_one(".fp-duration")
    if dur_el:
        meta.duration = dur_el.get_text(strip=True)

    # fallback: tools-left > Duration
    if not meta.duration:
        for li in soup.select(".tools-left li"):
            title_span = li.select_one(".title")
            if title_span and "duration" in title_span.get_text(strip=True).lower():
                desc = li.select_one(".title-description")
                if desc:
                    meta.duration = desc.get_text(strip=True)
                    break

    meta.duration_secs = _parse_duration_secs(meta.duration)

    # --- page_url ---
    tw = soup.select_one(".sharesTwitter")
    if tw:
        href = tw.get("href", "")
        m = re.search(r"url=([^&]+)", href)
        if m:
            meta.page_url = unquote(m.group(1))

    # --- video_id ---
    vid = soup.select_one("[data-video-id]")
    if vid:
        meta.video_id = vid.get("data-video-id", "")

    # --- categories ---
    for a in soup.select('.description a[href*="/categories/"]'):
        cat = a.get_text(strip=True)
        if cat and cat not in meta.categories:
            meta.categories.append(cat)

    # --- tags ---
    for a in soup.select('.description a[href*="/tags/"]'):
        tag = a.get_text(strip=True)
        if tag and tag not in meta.tags:
            meta.tags.append(tag)

    # --- author ---
    author_el = soup.select_one(".description a.author")
    if author_el:
        meta.author = author_el.get_text(strip=True)

    # --- rating ---
    rating_el = soup.select_one("#rating_container")
    if rating_el:
        stars = rating_el.select('img[src*="star-1.png"]')
        meta.rating = len(stars)  # 简化: 完整星数

    # --- views ---
    for li in soup.select(".tools-left li"):
        title_span = li.select_one(".title")
        if title_span and "viewed" in title_span.get_text(strip=True).lower():
            desc = li.select_one(".title-description")
            if desc:
                try:
                    meta.views = int(desc.get_text(strip=True).replace(",", ""))
                except ValueError:
                    pass
            break

    # --- mp4_url ---
    mp4 = soup.select_one(".fp-engine[src]")
    if mp4:
        meta.mp4_url = _ensure_https(mp4.get("src", ""))

    # --- download preview image ---
    if download_preview and meta.preview_url:
        dest_dir = Path(download_dir) if download_dir else Path(".")
        dest_dir.mkdir(parents=True, exist_ok=True)
        try:
            resp = requests.get(meta.preview_url, timeout=30)
            resp.raise_for_status()
            # infer filename
            parsed = urlparse(meta.preview_url)
            fname = Path(parsed.path).name or f"{meta.video_id}.jpg"
            dest = dest_dir / fname
            dest.write_bytes(resp.content)
            meta.preview_local_path = str(dest.resolve())
            logger.info("preview.jpg saved → %s", dest)
        except Exception as exc:
            logger.warning("Failed to download preview: %s", exc)

    return meta


# ---------------------------------------------------------------------------
# CLI demo
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    html_path = sys.argv[1] if len(sys.argv) > 1 else None
    if not html_path:
        print("Usage: python html_extractor.py <html_file>")
        sys.exit(1)

    html = Path(html_path).read_text(encoding="utf-8")
    meta = extract_meta(html)
    print(json.dumps(meta.to_dict(), indent=2, ensure_ascii=False, default=str))
