# 视频去重下载系统（video-dedup-system）

浏览器插件 + FastAPI + MySQL + Redis + FFmpeg 截图 + IDM 下载 + NAS 存储。

## 技术栈
- Backend: FastAPI + SQLAlchemy + Pydantic
- DB: MySQL 8+
- Cache: Redis 6+
- Task Scheduler: APScheduler（定时截图）
- Screenshot: FFmpeg
- Download: IDM（命令行桥接）
- Extension: Chrome Manifest V3

## 目录结构
```
├── backend/            # FastAPI 服务
│   └── app/
│       ├── api/        # 路由层 (v1)
│       ├── core/       # 配置、Redis 客户端
│       ├── db/         # 数据库连接
│       ├── models/     # ORM 模型
│       ├── schemas/    # Pydantic 模型
│       ├── services/   # 业务逻辑层
│       │   ├── video_service.py      # 视频 CRUD + 去重
│       │   ├── screenshot_service.py # 截图服务
│       │   ├── scheduler.py          # 定时任务
│       │   └── idm_service.py        # IDM 桥接
│       └── utils/      # 工具函数
├── extension/          # Chrome 浏览器插件
│   ├── manifest.json
│   ├── background.js
│   ├── content/
│   ├── popup/          # 插件弹窗
│   ├── options/        # 设置页面
│   └── icons/          # 插件图标
├── sql/                # MySQL 建表脚本
├── redis/              # Redis 配置说明
├── scripts/            # 工具脚本
│   ├── idm_bridge.py   # IDM Python 桥接
│   └── idm_bridge.ps1  # IDM PowerShell 桥接
└── docs/               # 文档
```

## 快速启动

### 1. 后端
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# 编辑 .env 填入数据库密码、API_KEY 等
uvicorn app.main:app --host 0.0.0.0 --port 18080 --reload
```

### 2. 数据库
```bash
mysql -u root -p < sql/001_init.sql
```

### 3. Chrome 插件
1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `extension/` 目录
5. 右键插件图标 → 选项 → 配置 API 地址和 Key

## API 列表
| 接口 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查（免鉴权） |
| `/api/v1/videos/search` | GET | 模糊搜索 |
| `/api/v1/videos/check` | GET | 检查视频是否存在 |
| `/api/v1/videos` | POST | 添加视频记录 |
| `/api/v1/videos` | GET | 获取列表 |
| `/api/v1/videos/{id}` | GET | 获取详情 |
| `/api/v1/videos/{id}` | DELETE | 软删除 |
| `/api/v1/videos/{id}/screenshot` | PUT | 更新截图路径 |
| `/api/v1/videos/stats` | GET | 统计信息 |
| `/api/v1/videos/import` | POST | 批量导入 |
| `/api/v1/videos/screenshot/pending` | GET | 待截图列表 |
| `/api/v1/videos/screenshot/process` | POST | 手动触发截图 |
| `/api/v1/videos/scan-local` | POST | 扫描本地目录批量导入 |

> 除 `/health` 外，均需 Header: `X-API-Key: <API_KEY>`

## 插件工作流程
```
用户访问视频页面 → content.js 提取元信息
  → popup 展示视频信息 → 用户点击「检查」
  → background.js 调用 /api/v1/videos/check
  → 展示去重结果（strong/medium/weak）
  → 用户确认 → background.js 调用 POST /api/v1/videos
  → IDM 触发下载（桥接脚本）
  → 后台定时任务 FFmpeg 截图回写
```

## 去重策略
| 级别 | 条件 | 动作 |
|------|------|------|
| strong | 标题标准化一致 + 时长差 ≤3s | 自动拦截 |
| medium | 拼音一致 + 时长差 ≤5s + 大小差 ≤5% | 高亮提示 |
| weak | 标题模糊命中 | 轻度提示 |

## 当前进度
- [x] MySQL DDL + 索引设计
- [x] Redis 缓存规范
- [x] FastAPI 核心接口（12个）
- [x] 去重三级策略
- [x] APScheduler 定时截图（默认 5 分钟）
- [x] FFmpeg 截图 + 失败重试 3 次
- [x] IDM 命令行桥接（Python + PS1）
- [x] Chrome 插件完整源码（Manifest V3）
- [x] IDM 命令行桥接（Python + PS1）
- [x] 部署文档（docs/DEPLOY.md）
- [x] 验收清单（docs/ACCEPTANCE.md，43 项用例）
