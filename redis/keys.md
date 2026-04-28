# Redis Key 规范

## 去重缓存
- `video:dedup:hash:{video_hash}` -> `{video_id}`
  - TTL: 30 天

- `video:dedup:url:{sha1(source_url)}` -> `{video_id}`
  - TTL: 30 天

## 任务队列
- `queue:download` (List)
  - 元素: JSON(task)

- `task:download:{task_id}` (Hash)
  - 字段: status, progress, local_path, error
  - TTL: 7 天

## 统计
- `stats:daily:{yyyy-mm-dd}` (Hash)
  - 字段: import_count, duplicate_count, download_count
  - TTL: 90 天
