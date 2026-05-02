"""
重建所有视频的 title_normalized 和 title_pinyin
运行: python scripts/rebuild_normalized.py
"""
import sys
sys.path.insert(0, '.')
from app.db.session import SessionLocal
from app.models.video import Video
from app.utils.text import normalize_title, title_to_pinyin

db = SessionLocal()
videos = db.query(Video).filter(Video.is_deleted == 0).all()
print(f"共 {len(videos)} 条记录")

for v in videos:
    old_norm = v.title_normalized
    old_pinyin = v.title_pinyin
    v.title_normalized = normalize_title(v.title)
    v.title_pinyin = title_to_pinyin(v.title)
    if old_norm != v.title_normalized or old_pinyin != v.title_pinyin:
        print(f"  #{v.id} {v.title[:40]:40s} norm: {old_norm[:20] or '(空)':20s} -> {v.title_normalized[:20]}")

db.commit()
db.close()
print("Done")
