# 视频去重下载系统 — 部署文档

> 目标环境：Windows 台式机（也可 Linux/macOS 参考）
> 最后更新：2026-04-28

---

## 1. 前置依赖

| 软件 | 版本要求 | 下载/安装方式 |
|------|---------|-------------|
| Python | ≥3.10 | [python.org](https://python.org) |
| MySQL | ≥8.0 | [mysql.com](https://dev.mysql.com/downloads/) 或 XAMPP |
| Redis | ≥6.0 | [redis.io](https://redis.io/download/) 或 Windows 版用 Memurai |
| FFmpeg | ≥4.0 | [ffmpeg.org](https://ffmpeg.org/download.html) |
| IDM | 任意 | [internetdownloadmanager.com](https://www.internetdownloadmanager.com/)（可选） |
| Chrome | ≥88 | [google.com/chrome](https://www.google.com/chrome/) |

> Redis 在 Windows 上可使用 [Memurai](https://www.memurai.com/) 或 WSL2 中的 Redis。

---

## 2. 安装步骤

### 2.1 获取源码

```bash
# 将项目目录复制到台式机
D:\> cd D:\projects
D:\projects> xcopy /E 视频去重下载系统源码路径 video-dedup-system\
```

### 2.2 创建 Python 虚拟环境

```bash
cd D:\projects\video-dedup-system\backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### 2.3 配置环境变量

```bash
copy .env.example .env
notepad .env
```

按你的机器修改以下项（其他保持默认即可）：

| 变量 | 说明 | 示例 |
|------|------|------|
| `MYSQL_HOST` | MySQL 地址 | 127.0.0.1 |
| `MYSQL_PORT` | MySQL 端口 | 3306 |
| `MYSQL_DB` | 数据库名 | video_dedup |
| `MYSQL_USER` | MySQL 用户 | root |
| `MYSQL_PASSWORD` | MySQL 密码 | 你的密码 |
| `API_KEY` | API 密钥 | 自己生成一个 |
| `SCREENSHOT_DIR` | 截图保存目录 | D:/Downloads/Screenshots |
| `FFMPEG_BIN` | FFmpeg 路径 | C:/ffmpeg/bin/ffmpeg.exe |
| `IDM_EXE` | IDM 可执行文件 | C:/Program Files (x86)/Internet Download Manager/IDMan.exe |
| `DOWNLOAD_ROOT` | 下载保存目录 | D:/Downloads/Movies |

### 2.4 初始化数据库

```bash
# 方式 A：mysql 命令行
mysql -u root -p < ..\sql\001_init.sql

# 方式 B：登录后 source
mysql -u root -p
mysql> source D:/projects/video-dedup-system/sql/001_init.sql
```

### 2.5 启动 Redis

```bash
# Windows (Memurai)
redis-server.exe

# Linux/WSL
redis-server
```

验证：
```bash
redis-cli ping   # 应返回 PONG
```

### 2.6 启动后端

```bash
cd backend
.venv\Scripts\activate
uvicorn app.main:app --host 0.0.0.0 --port 18080
```

看到以下输出即启动成功：
```
INFO:     Started server process
INFO:     Application startup complete.
```

### 2.7 验证后端

```bash
# 健康检查（免鉴权）
curl http://127.0.0.1:18080/health
# → {"status":"ok"}

# 带鉴权的接口
curl -H "X-API-Key: 你的API_KEY" http://127.0.0.1:18080/api/v1/videos/stats
# → {"total_videos":0,"total_size_mb":0,"total_duration_secs":0,"pending_screenshot":0}
```

或浏览器打开 Swagger 文档：
```
http://127.0.0.1:18080/docs
```
点右上角 `Authorize`，输入 API Key 后即可在线测试所有接口。

---

## 3. Chrome 插件安装

1. 打开 Chrome 浏览器
2. 地址栏输入 `chrome://extensions/`
3. 右上角开启「**开发者模式**」
4. 点击「**加载已解压的扩展程序**」
5. 选择 `extension/` 目录（即包含 `manifest.json` 的文件夹）
6. 插件图标出现在工具栏

### 配置插件

1. 右键插件图标 →「选项」
2. 填写 API 地址：`http://127.0.0.1:18080`
3. 填写 API Key：与 `.env` 中 `API_KEY` 一致
4. 下载文件夹：`D:/Downloads/Movies`
5. 点击「测试连接」确认连通
6. 点击「保存设置」

---

## 4. 截图服务配置

截图服务已内置 APScheduler 定时任务，后端启动后自动运行。

默认每 **5 分钟**处理一批（20 个视频），可在 `.env` 修改：

```
SCREENSHOT_BATCH_SIZE=20
SCREENSHOT_INTERVAL_MINUTES=5
```

也可手动触发：
```bash
curl -X POST -H "X-API-Key: 你的KEY" \
  http://127.0.0.1:18080/api/v1/videos/screenshot/process \
  -H "Content-Type: application/json" \
  -d '{"limit": 20}'
```

---

## 5. 开机自启（可选）

### 方式 A：Windows 任务计划程序

1. 打开「任务计划程序」
2. 创建基本任务 → 名称「视频去重后端」
3. 触发器：登录时
4. 操作：启动程序
   - 程序：`D:\projects\video-dedup-system\backend\.venv\Scripts\python.exe`
   - 参数：`-m uvicorn app.main:app --host 0.0.0.0 --port 18080`
   - 起始于：`D:\projects\video-dedup-system\backend`

### 方式 B：批处理 + 启动文件夹

创建 `start_backend.bat`：
```batch
@echo off
cd /d D:\projects\video-dedup-system\backend
call .venv\Scripts\activate
uvicorn app.main:app --host 0.0.0.0 --port 18080
```

放入 `shell:startup` 文件夹。

---

## 6. 目录结构（部署后）

```
D:\projects\video-dedup-system\
├── backend\            # FastAPI 服务
│   ├── .env            # 你编辑的配置文件
│   ├── .venv\          # Python 虚拟环境
│   └── data\
│       └── screenshots\  # 截图输出目录
├── extension\          # Chrome 插件
├── sql\                # SQL 脚本
├── scripts\            # IDM 桥接
D:\Downloads\
├── Movies\             # 视频下载目录
└── Screenshots\        # 截图目录（与配置一致）
```

---

## 7. 常见问题

### Q: pip install 时报 mysqlclient 错误
使用 PyMySQL 替代，本系统已配置。

### Q: Redis 连不上
确认 Redis 已启动，检查 `REDIS_HOST`/`REDIS_PORT` 配置。

### Q: 截图失败
- 确认 FFmpeg 已安装且在 PATH 中，或已配置 `FFMPEG_BIN`
- 确认 `download_path` 指向的文件存在
- 查看后端日志输出

### Q: Chrome 插件报 "Cannot connect"
- 检查「选项」中 API 地址是否正确
- 确认后端已启动
- 确认 `chrome://extensions` 中插件已启用
