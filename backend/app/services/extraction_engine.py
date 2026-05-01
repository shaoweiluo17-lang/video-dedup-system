"""
Extraction Engine — Rule-driven HTML metadata extractor.

Loads extraction_rules.json and applies CSS-selector-based rules
to extract structured metadata from video page HTML.

Usage:
    engine = ExtractionEngine()
    meta = engine.extract(html_string)
    print(meta.title, meta.page_url)
"""

from __future__ import annotations

import json
import re
import logging
from copy import deepcopy
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import unquote

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

RULES_PATH = Path(__file__).parent / "extraction_rules.json"


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class VideoPageMeta:
    """从视频页面提取的元数据"""
    title: str = ""
    preview_url: str = ""
    preview_local_path: Optional[str] = None
    duration: str = ""
    duration_secs: int = 0
    page_url: str = ""
    video_id: str = ""
    mp4_url: str = ""
    categories: List[str] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)
    author: str = ""
    rating: float = 0.0
    views: int = 0
    added_date: str = ""
    raw: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Post-processing actions
# ---------------------------------------------------------------------------

def _ensure_https(value: str) -> str:
    if value.startswith("//"):
        return "https:" + value
    return value


def _url_decode(value: str) -> str:
    return unquote(value)


def _strip_chars(value: str, chars: str = ",") -> str:
    return value.replace(chars, "")


def _to_int(value: str) -> int:
    try:
        return int(value.strip())
    except (ValueError, TypeError):
        return 0


def _parse_duration_secs(duration: str) -> int:
    parts = list(map(int, duration.strip().split(":")))
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    elif len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    return 0


POST_PROCESSORS = {
    "ensure_https": _ensure_https,
    "url_decode": _url_decode,
    "strip_chars": _strip_chars,
    "to_int": _to_int,
    "parse_duration_secs": _parse_duration_secs,
}


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

class ExtractionEngine:
    """规则驱动的 HTML 元数据提取引擎"""

    def __init__(self, rules_path: Optional[str] = None):
        path = Path(rules_path) if rules_path else RULES_PATH
        with open(path, encoding="utf-8") as f:
            self.config = json.load(f)
        self.rules: List[dict] = self.config.get("rules", [])
        self.global_config: dict = self.config.get("global_config", {})
        logger.info("ExtractionEngine loaded %d rules from %s", len(self.rules), path)

    def extract(self, html: str) -> VideoPageMeta:
        """从 HTML 字符串提取 VideoPageMeta"""
        soup = BeautifulSoup(html, "html.parser")
        flashvars = self._parse_flashvars(soup)
        meta = VideoPageMeta()

        for rule in self.rules:
            field = rule["field"]
            value = self._apply_rule(rule, soup, flashvars)

            # transform 处理（如 duration → duration_secs）
            transform = rule.get("transform")
            if transform and value is not None:
                action = transform.get("action", "")
                output_field = transform.get("output_field", "")
                if action == "parse_duration_secs":
                    setattr(meta, output_field, _parse_duration_secs(str(value)))

            if value is not None and value != "" and value != []:
                setattr(meta, field, value)

        # 兼容: raw 中存一份完整快照
        meta.raw = meta.to_dict()
        return meta

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _apply_rule(self, rule: dict, soup: BeautifulSoup,
                    flashvars: dict) -> Any:
        """应用单条规则，返回提取值或 None"""
        selectors = rule.get("selectors", [])
        for sel in selectors:
            value = self._eval_selector(sel, soup, flashvars)
            if value is not None and value != "" and value != []:
                return value

        # fallback
        for fb in rule.get("fallback", []):
            value = self._eval_selector(fb, soup, flashvars)
            if value is not None and value != "" and value != []:
                return value

        return None

    def _eval_selector(self, sel: dict, soup: BeautifulSoup,
                       flashvars: dict) -> Any:
        """执行单个选择器定义"""
        source = sel.get("source", "")

        # --- flashvars source ---
        if source == "flashvars":
            key = sel.get("key", "")
            value = flashvars.get(key, "")
            return self._post_process(value, sel)

        # --- CSS selector ---
        css = sel.get("css", "")
        if not css:
            return None

        method = sel.get("method", "text")
        multi = sel.get("multi", False)
        has_keyword = bool(sel.get("filter_keyword", ""))

        # When filter_keyword is present, iterate all matches (not just first)
        if has_keyword or multi:
            elements = soup.select(css)
            if has_keyword and not multi:
                for el in elements:
                    v = self._extract_from_element(el, sel)
                    if v is not None and v != "" and v != []:
                        return v
                return None
            results = []
            for el in elements:
                v = self._extract_from_element(el, sel)
                if v:
                    results.append(v)
            return results if results else None

        if method == "count":
            return len(soup.select(css))

        # single element (no keyword, no multi)
        el = soup.select_one(css)
        if not el:
            return None

        return self._extract_from_element(el, sel)

    def _extract_from_element(self, el, sel: dict) -> Any:
        """从 BeautifulSoup 元素提取值"""
        method = sel.get("method", "text")

        # 关键词过滤（用于 list-item 场景）
        keyword = sel.get("filter_keyword", "")
        if keyword:
            text = el.get_text(strip=True)
            if keyword.lower() not in text.lower():
                return None
            # 如果有 child_selector，进子元素取
            child_css = sel.get("child_selector", "")
            if child_css:
                child = el.select_one(child_css)
                if child:
                    value = child.get_text(strip=True) if method == "text" else child.get(child_css.split(".")[-1], "")
                    return self._post_process(value, sel)
                return None

        if method == "text":
            trim = sel.get("trim", False)
            text = el.get_text()
            return text.strip() if trim else text

        if method == "attr":
            attr = sel.get("attr", "")
            value = el.get(attr, "")
            return self._post_process(value, sel)

        return None

    def _post_process(self, value: Any, sel: dict) -> Any:
        """执行 post_process 管道"""
        if not value:
            return value

        # validate regex
        validate = sel.get("validate", "")
        if validate:
            if not re.match(validate, str(value)):
                return None

        for pp in sel.get("post_process", []):
            action = pp.get("action", "")
            if action == "regex_extract":
                pattern = pp.get("pattern", "")
                m = re.search(pattern, str(value))
                value = m.group(1) if m else ""
            else:
                func = POST_PROCESSORS.get(action)
                if func:
                    if action == "strip_chars":
                        value = func(str(value), pp.get("chars", ","))
                    else:
                        value = func(str(value))
        return value

    def _parse_flashvars(self, soup: BeautifulSoup) -> dict:
        """从 script 标签中解析 flashvars JSON"""
        if not self.global_config.get("flashvars_detection", {}).get("enabled"):
            return {}

        pattern = self.global_config["flashvars_detection"].get("pattern",
            r"(\w+)\s*:\s*'([^']+)'")
        for script in soup.find_all("script"):
            text = script.string or ""
            if "flashvars" in text:
                result = {}
                for m in re.finditer(pattern, text):
                    key = m.group(1)
                    val = m.group(2)
                    # skip JS keywords
                    if key in ("var", "function", "return"):
                        continue
                    result[key] = val
                return result
        return {}


# ---------------------------------------------------------------------------
# CLI demo
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    html_path = sys.argv[1] if len(sys.argv) > 1 else None
    if not html_path:
        print("Usage: python extraction_engine.py <html_file>")
        sys.exit(1)

    engine = ExtractionEngine()
    html = Path(html_path).read_text(encoding="utf-8")
    meta = engine.extract(html)
    print(json.dumps(meta.to_dict(), indent=2, ensure_ascii=False, default=str))
