-- ============================================================
-- 清理批量导入时拼接的域名后缀
-- 先执行 SELECT 预览 → 确认无误再执行 UPDATE
-- ============================================================

-- 1. 预览受影响的行
SELECT id, title,
       TRIM(REPLACE(REPLACE(title, ' - media.mytest.com', ''), ' — media.mytest.com', '')) AS new_title
FROM videos
WHERE title LIKE '%media.mytest.com%'
  AND is_deleted = 0;

-- 2. 确认后执行更新
UPDATE videos
SET title = TRIM(REPLACE(REPLACE(title, ' - media.mytest.com', ''), ' — media.mytest.com', '')),
    title_normalized = LOWER(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
        TRIM(REPLACE(REPLACE(title, ' - media.mytest.com', ''), ' — media.mytest.com', '')),
        ' ', ''), '-', ''), '—', ''), '.', ''), '_', ''), '|', '')),
    title_pinyin = ''
WHERE title LIKE '%media.mytest.com%'
  AND is_deleted = 0;

-- 3. 验证
SELECT id, title, title_normalized FROM videos WHERE title_pinyin = '' AND is_deleted = 0;
