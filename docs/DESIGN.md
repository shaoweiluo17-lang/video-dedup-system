> **版本**: V1.0  
> **状态**: 已交付  
> **最后更新**: 2026-04-27  
> **代码版本**: 与 `backend/app/` 一致  

---

# 视频去重下载系统 — 技术设计文档（DESIGN）

## 1. 架构概览

```
┌─────────────────────────────┐
│   Chrome 插件（Phase 2）     │
└─────────────┬───────────────┘
              │ HTTP / X-API-Key
┌─────────────▼───────────────┐
│   FastAPI  (uvicorn)        │
│   ├─ api/v1/videos.py       │
│   ├─ api/v1/health.py       │
│   ├─ api/deps.py (鉴权)     │
│   └─ main.py (lifespan)     │
├─────────────────────────────┤
│   Service 层                 │
│   ├─ video_service.py       │
│   ├─ screenshot_service.py  │
│   ├─ scanner_service.py     │
│   └─ scheduler.py           │
├─────────────────────────────┤
│   数据层                     │
│   ├─ MySQL 8.0+ (SQLAlchemy)│
│   └─ Redis 6+               │
├─────────────────────────────┤
│   工具层                     │
│   ├─ FFmpeg / ffprobe       │
│   └─ IDM (桥接预留)         │
└─────────────────────────────┘
```

- **API 层**：FastAPI + Pydantic v2，REST 风格
- **业务层**：去重匹配、批量导入、统计、截图、本地扫描
- **数据层**：MySQL（持久化元数据）+ Redis（搜索/去重/统计缓存 + 截图队列）
- **调度器**：APScheduler 后台定时截图任务
- **静态文件**：FastAPI `StaticFiles` 挂载 `/screenshots/` 供预览访问

---

## 2. 模块设计

### 2.1 目录结构

```
backend/
├── app/
│   ├── main.py               # 入口: lifespan + 路由挂载 + 静态文件
│   ├── api/
│   │   ├── deps.py           # X-API-Key 鉴权依赖
│   │   ├── router.py         # 路由汇总
│   │   └── v1/
│   │       ├── health.py     # /health
│   │       └── videos.py     # /api/v1/videos/*
│   ├── core/
│   │   ├── config.py         # pydantic-settings 配置中心
│   │   └── redis_client.py   # Redis 连接工厂
│   ├── db/
│   │   └── session.py        # SQLAlchemy engine + session + Base
│   ├── models/
│   │   ├── video.py          # Video ORM
│   │   └── download_history.py # DownloadHistory ORM
│   ├── schemas/
│   │   ├── common.py         # HealthResponse
│   │   └── video.py          # 全部 Pydantic 模型
│   ├── services/
│   │   ├── video_service.py  # 去重 / CRUD / 导入 / 统计
│   │   ├── screenshot_service.py  # 截图任务
│   │   ├── scanner_service.py     # 本地目录扫描
│   │   └── scheduler.py      # 后台定时截图
│   └── utils/
│       └── text.py           # 标题标准化 / 拼音 / hash
├── .env.example
└── requirements.txt
```

### 2.2 核心模块说明

| 模块 | 职责 |
|------|------|
| `video_service` | 去重判定（URL > 标题）、CRUD、批量导入、统计 |
| `screenshot_service` | 拉取待截图记录 → ffmpeg 截图 → 写回 screenshot_path |
| `scanner_service` | 递归扫描本地目录 → ffprobe 提取时长 → 批量入库 |
| `scheduler` | APScheduler 后台定时执行 screenshot_tick |
| `deps` | FastAPI 依赖注入，校验 `X-API-Key` Header |
| `config` | 集中管理环境变量（`.env` + `pydantic-settings`） |

---

## 3. 数据库设计

### 3.1 videos（视频主表）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | BIGINT PK | 自增 |
| `url` | VARCHAR(2048) | 网页 URL |
| `title` | VARCHAR(512) | 视频标题 |
| `title_pinyin` | VARCHAR(512) | 拼音（自动生成） |
| `title_normalized` | VARCHAR(512) | 标准化标题（去空格/小写） |
| `size_mb` | DECIMAL(10,2) | 文件大小 |
| `duration_secs` | INT | 时长（秒） |
| `duration_str` | VARCHAR(20) | 时长字符串 |
| `category` | VARCHAR(50) | 分类 |
| `source_site` | VARCHAR(100) | 来源站域名 |
| `download_date` | DATETIME | 下载日期 |
| `download_path` | VARCHAR(1024) | 本地路径 |
| `preview_path` | VARCHAR(512) | 预览图路径 |
| `screenshot_path` | VARCHAR(512) | 截图路径 |
| `created_at` | DATETIME | 创建时间 |
| `updated_at` | DATETIME | 更新时间 |
| `is_deleted` | TINYINT | 软删除标记 |

**索引**：url, title, title_normalized, title_pinyin, duration_secs, source_site, download_date, created_at

### 3.2 download_history（下载历史）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | BIGINT PK | 自增 |
| `video_id` | BIGINT FK | 关联 videos.id |
| `url` | VARCHAR(2048) | 网页 URL |
| `download_path` | VARCHAR(1024) | 保存路径 |
| `status` | VARCHAR(20) | pending / completed / failed |
| `error_message` | TEXT | 错误信息 |
| `created_at` | DATETIME | 创建时间 |

---

## 4. Redis 设计

| Key | 类型 | TTL | 说明 |
|-----|------|-----|------|
| `video:search:{hash}` | String(JSON) | 300s | 搜索结果缓存 |
| `video:stats` | String(JSON) | 3600s | 统计结果缓存（写入时主动删除） |
| `video:pending_screenshot` | List | 永久 | 待截图视频 ID 队列 |

> **注意**：去重 `check` 返回值较灵活且实时性要求高，当前未缓存到 Redis（如需可后续加 TTL=600s）。

---

## 5. 核心流程设计

### 5.1 去重流程（check）

```
请求 (title, url, duration_secs, size_mb, source_site)
    │
    ├─ URL 标准化（去尾斜杠、去查询参数）
    ├─ 标题标准化（全角→半角空格合并、小写）
    ├─ 标题拼音转换（pypinyin）
    │
    ├─ 第 1 轮：URL 完全匹配 → strong(1.0)
    ├─ 第 1 轮：URL 前缀匹配 → strong(0.96)
    │
    ├─ 第 2 轮：标题标准化完全匹配 → strong(0.98)
    ├─ 第 2 轮：拼音匹配 + 时长≤5s + 大小≤5% → medium(0.85)
    ├─ 第 2 轮：标题模糊匹配 → weak(0.60)
    │
    └─ 返回 { exists, level, matches }
```

### 5.2 扫描入库流程（scan-local）

```
POST /api/v1/videos/scan-local { directory, extensions, max_files }
    │
    ├─ os.walk 递归收集视频文件（生成器，不爆内存）
    ├─ 逐文件处理：
    │   ├─ 扩展名校验
    │   ├─ 文件大小检查 (>20GB 跳过)
    │   ├─ ffprobe 提取时长
    │   ├─ 文件名 → 标题（清洗特殊字符/分辨率标签）
    │   ├─ 路径去重（dedup_by_path 已存在则跳过）
    │   └─ 入库 → 统计 new/skipped/error
    │
    ├─ 清除 Redis stats 缓存
    └─ 返回 { total_found, total_new, total_skipped_duplicate, total_error, items(可选) }
```

### 5.3 截图流程

```
定时触发 (scheduler interval) 或 手动 POST /process
    │
    ├─ 查询 videos(is_deleted=0, screenshot_path IS NULL) LIMIT batch_size
    ├─ 逐记录：
    │   ├─ 校验 download_path 存在
    │   ├─ ffmpeg -ss 00:00:01 -frames:v 1 → screenshots/video_{id}.jpg
    │   ├─ 成功后写 screenshot_path
    │   └─ 失败计数
    └─ 返回 { processed, success, failed }
```

---

## 6. API 设计摘要

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/health` | 无 | 健康检查 |
| GET | `/api/v1/videos/search` | Key | 模糊搜索（分页+缓存） |
| GET | `/api/v1/videos/check` | Key | 去重检查 |
| POST | `/api/v1/videos` | Key | 新增视频 |
| GET | `/api/v1/videos` | Key | 全量列表（分页） |
| GET | `/api/v1/videos/{id}` | Key | 单条详情 |
| PUT | `/api/v1/videos/{id}` | Key | 按需更新 |
| DELETE | `/api/v1/videos/{id}` | Key | 软删除 |
| PUT | `/api/v1/videos/{id}/screenshot` | Key | 手动更新截图路径 |
| GET | `/api/v1/videos/stats` | Key | 统计（含缓存） |
| POST | `/api/v1/videos/import` | Key | 批量导入 |
| GET | `/api/v1/videos/screenshot/pending` | Key | 待截图列表 |
| POST | `/api/v1/videos/screenshot/process` | Key | 处理截图任务 |
| POST | `/api/v1/videos/scan-local` | Key | 扫描本地目录 |

---

## 7. 部署设计

### 7.1 环境要求
- Python ≥ 3.10
- MySQL 8.0+
- Redis 6+
- FFmpeg（含 ffprobe）

### 7.2 启动步骤

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # 按实际环境修改
uvicorn app.main:app --host 0.0.0.0 --port 18080 --reload
```

### 7.3 配置项（`.env`）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `APP_PORT` | 18080 | 服务端口 |
| `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_DB` | 127.0.0.1:3306/video_dedup | 数据库连接 |
| `REDIS_HOST` / `REDIS_PORT` | 127.0.0.1:6379 | Redis 连接 |
| `API_KEY` | change-me | 业务接口鉴权 |
| `SCREENSHOT_DIR` | ./data/screenshots | 截图输出目录 |
| `SCREENSHOT_BATCH_SIZE` | 20 | 每次截图批处理量 |
| `SCREENSHOT_INTERVAL_MINUTES` | 5 | 定时截图间隔 |
| `FFMPEG_BIN` | ffmpeg | FFmpeg 路径 |

---

## 8. 风险与应对

| 风险 | 应对 |
|------|------|
| 标题相似误判 | 多特征分级评分（URL > 标准化标题 > 拼音+时长+大小 > 模糊匹配） |
| 本地扫描大目录 OOM | os.walk 生成器 + max_files 上限；结果默认不返回 items |
| ffprobe 超时/卡住 | 子进程硬超时 30s；单文件 >20GB 跳过 |
| FFmpeg 截图失败 | 错误计数不阻塞流程；定时重试 |
| 缓存脏数据 | TTL + 写操作主动 delete Redis key |
| 下载器不兼容 | IDM 桥接接口化，可替换为 aria2 等 |

---

## 9. 后续演进（Phase 2）

- [ ] Chrome 插件端接入
- [ ] IDM 真实任务状态回写
- [ ] 管理后台 Web UI
- [ ] 去重阈值后台可配置
- [ ] 多数据源适配器抽象
- [ ] 下载队列优先级调度
