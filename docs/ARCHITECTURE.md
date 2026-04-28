# 架构设计（Phase 1）

## 模块
1. Chrome 插件（后续）
2. FastAPI 网关服务（本期）
3. MySQL 元数据存储（本期）
4. Redis 缓存/队列（本期）
5. FFmpeg 截图服务（本期）
6. IDM 下载桥接（本期 mock，后续 real）

## 流程
1. 插件抓取到视频候选信息后，调用 `/api/videos/check-duplicate`
2. 若非重复，调用 `/api/videos` 入库并触发 `/api/videos/trigger-download`
3. 下载完成后回写 `download_history` + 更新 `videos.local_path`
4. 需要截图时调用 `/api/videos/screenshot`
