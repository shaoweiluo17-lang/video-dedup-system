-- 视频去重下载系统 MySQL 建表脚本
-- 建议 MySQL 8.0+

CREATE DATABASE IF NOT EXISTS `video_dedup` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE `video_dedup`;

CREATE TABLE IF NOT EXISTS `videos` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `url` VARCHAR(2048) NOT NULL DEFAULT '' COMMENT '网页 URL',
  `title` VARCHAR(512) NOT NULL DEFAULT '' COMMENT '视频标题',
  `title_pinyin` VARCHAR(512) NOT NULL DEFAULT '' COMMENT '标题拼音',
  `title_normalized` VARCHAR(512) NOT NULL DEFAULT '' COMMENT '标准化标题（全小写）',
  `size_mb` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '文件大小(MB)',
  `duration_secs` INT NOT NULL DEFAULT 0 COMMENT '时长(秒)',
  `duration_str` VARCHAR(20) NOT NULL DEFAULT '' COMMENT '时长字符串',
  `category` VARCHAR(50) NOT NULL DEFAULT '' COMMENT '分类',
  `source_site` VARCHAR(100) NOT NULL DEFAULT '' COMMENT '来源网站',
  `download_date` DATETIME NULL COMMENT '下载日期',
  `download_path` VARCHAR(1024) NOT NULL DEFAULT '' COMMENT '下载保存路径',
  `screenshot_path` VARCHAR(512) NOT NULL DEFAULT '' COMMENT '截图路径（下载完成后更新）',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `is_deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '软删除标记',
  PRIMARY KEY (`id`),
  KEY `idx_videos_url` (`url`(255)),
  KEY `idx_videos_title` (`title`),
  KEY `idx_videos_title_pinyin` (`title_pinyin`),
  KEY `idx_videos_title_normalized` (`title_normalized`),
  KEY `idx_videos_duration_secs` (`duration_secs`),
  KEY `idx_videos_source_site` (`source_site`),
  KEY `idx_videos_download_date` (`download_date`),
  KEY `idx_videos_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='视频主表';

CREATE TABLE IF NOT EXISTS `download_history` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `video_id` BIGINT NULL COMMENT '关联 videos.id',
  `url` VARCHAR(2048) NOT NULL DEFAULT '' COMMENT '网页 URL',
  `download_path` VARCHAR(1024) NOT NULL DEFAULT '' COMMENT '保存路径',
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/completed/failed',
  `error_message` TEXT NULL COMMENT '错误信息',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_download_history_video_id` (`video_id`),
  KEY `idx_download_history_status` (`status`),
  KEY `idx_download_history_created_at` (`created_at`),
  CONSTRAINT `fk_download_history_video_id` FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='下载历史表';
