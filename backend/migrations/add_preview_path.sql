-- ============================================================
-- 2026-05-01: 新增 preview_path 字段
-- 作用: 存储从网页预览图 URL 下载的图片本地路径
-- 与 screenshot_path (ffmpeg 截第1秒) 独立，互不覆盖
-- ============================================================

ALTER TABLE videos ADD COLUMN preview_path VARCHAR(512) DEFAULT '' AFTER download_path;
