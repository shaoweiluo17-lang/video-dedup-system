# API 说明（Phase 1）

## 健康检查
- `GET /api/health`

## 视频
- `POST /api/videos/check-duplicate`
- `GET /api/videos/search?keyword=&page=1&page_size=20`
- `POST /api/videos`
- `PUT /api/videos/{video_id}`
- `DELETE /api/videos/{video_id}`
- `POST /api/videos/import`
- `GET /api/videos/stats`
- `POST /api/videos/screenshot?video_path=&output_path=`
- `POST /api/videos/trigger-download?url=&save_path=`
