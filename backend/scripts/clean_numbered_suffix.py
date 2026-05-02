#!/usr/bin/env python
"""
清理数据库中已有标题的文件名编号后缀：我的视频_1 → 我的视频
运行：python scripts/clean_numbered_suffix.py
"""
import sys
sys.path.insert(0, '.')
import re
from app.db.session import SessionLocal
from app.models.video import Video
from app.utils.text import normalize_title, title_to_pinyin

db = SessionLocal()

# 匹配末尾编号： _1 _2 _10 、 (1) (2) (10) 、 -1 -2 -10 、空格+数字
NUM_SUFFIX_RE = re.compile(r'[\s_\-]*[\[\(]?\d+[\]\)]?$')

# 先查所有
videos = db.query(Video).filter(Video.is_deleted == 0).order_by(Video.id).all()
print(f"共 {len(videos)} 条记录，扫描编号后缀...")

updated = 0
skipped = 0
for v in videos:
    # 去掉末尾编号后缀
    cleaned = NUM_SUFFIX_RE.sub('', v.title).strip()
    if not cleaned:
        skipped += 1
        continue
    if cleaned == v.title:
        continue  # 没变化

    old = v.title
    v.title = cleaned
    v.title_normalized = normalize_title(cleaned)
    v.title_pinyin = title_to_pinyin(cleaned)
    updated += 1
    print(f"  #{v.id} [{old}] → [{cleaned}]")

db.commit()
db.close()
print(f"\n✅ 完成：{updated} 条更新，{skipped} 条跳过")
