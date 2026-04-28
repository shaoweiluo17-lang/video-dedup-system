# 视频去重下载系统 — 验收清单

> 按顺序逐项验证，全部通过即交付完成。

---

## A. 环境就绪

| # | 检查项 | 方法 | 预期 |
|---|--------|------|------|
| A1 | MySQL 运行 | `mysql -u root -p -e "SELECT 1"` | 返回 1 |
| A2 | 数据库已建 | `mysql -u root -p -e "USE video_dedup; SHOW TABLES"` | 显示 `videos`, `download_history` |
| A3 | Redis 运行 | `redis-cli ping` | PONG |
| A4 | FFmpeg 可用 | `ffmpeg -version` | 显示版本信息 |
| A5 | Python 环境 | `python --version` | ≥3.10 |
| A6 | 依赖已装 | `pip list \| grep fastapi` | 显示 fastapi 0.115.0 |

---

## B. 后端 API — 健康与鉴权

| # | 接口 | 方法 | 预期 |
|---|------|------|------|
| B1 | `/health` | GET | `{"status":"ok"}` |
| B2 | `/api/v1/videos/stats`（无 Key） | GET | HTTP 401 |
| B3 | `/api/v1/videos/stats`（错误 Key） | GET + `X-API-Key: wrong` | HTTP 401 |
| B4 | `/api/v1/videos/stats`（正确 Key） | GET | `{"total_videos":0,...}` |

---

## C. CRUD 功能

| # | 接口 | 请求体 | 预期 |
|---|------|--------|------|
| C1 | `POST /api/v1/videos` | `{"url":"http://test.com/v/1","title":"星际穿越","size_mb":2048,"duration_secs":10140,"source_site":"test.com","download_path":"D:/Downloads/Movies/星际穿越.mp4"}` | 返回完整记录，id=1 |
| C2 | `POST /api/v1/videos` | 同上但改 duration_secs=10141 | 返回 id=2（不冲突） |
| C3 | `GET /api/v1/videos` | — | total=2, items 2条 |
| C4 | `GET /api/v1/videos/1` | — | 返回详情，title="星际穿越" |
| C5 | `DELETE /api/v1/videos/1` | — | `{"success":true}` |
| C6 | `GET /api/v1/videos/1` | — | HTTP 404 |
| C7 | `GET /api/v1/videos` | — | total=1（软删除不显示） |

---

## D. 去重检查

| # | 场景 | 预期结果 |
|---|------|----------|
| D1 | 检查完全相同的标题+时长 | `exists=true, level=strong` |
| D2 | 检查相同的标题但时长差 >3s | `exists=true, level=medium` 或 `weak` |
| D3 | 检查完全不同的标题 | `exists=false, level=none` |
| D4 | 检查相同拼音不同大小写 | `exists=true, level=strong`（已标准化） |

---

## E. 搜索

| # | 场景 | 预期 |
|---|------|------|
| E1 | `GET /search?query=星际` | 返回匹配记录 |
| E2 | `GET /search?query=notexist` | total=0 |
| E3 | `GET /search?query=星际&page=1&page_size=5` | 分页正确 |

---

## F. 统计

| # | 检查项 | 预期 |
|---|--------|------|
| F1 | 添加2条记录后查 stats | total_videos=2, total_size_mb>0 |

---

## G. 批量导入

| # | 场景 | 预期 |
|---|------|------|
| G1 | 导入3条新记录 | `success_count=3` |
| G2 | 再导入完全相同的3条 | `duplicate_count=3` |

---

## H. 截图服务

| # | 场景 | 预期 |
|---|------|------|
| H1 | `GET /screenshot/pending` | 返回 download_path 有内容但 screenshot_path 为空的记录 |
| H2 | `POST /screenshot/process {"limit":5}` | processed>0, success>0 |
| H3 | 查视频详情 | screenshot_path 已回写为本地 jpg 路径 |
| H4 | 检查本地文件 | 截图文件存在 `./data/screenshots/video_*.jpg` |

---

## I. 定时截图任务

| # | 场景 | 预期 |
|---|------|------|
| I1 | 启动后端，等待 6 分钟 | 查看日志输出 `screenshot_tick processed=X` |
| I2 | 中间停止 Redis | 截图任务主动跳过缓存操作，不影响 |

---

## J. Chrome 插件

| # | 场景 | 预期 |
|---|------|------|
| J1 | 插件安装成功 | 工具栏出现插件图标 |
| J2 | 打开「选项」页面 | API地址/Key/文件夹/后缀 可编辑并保存 |
| J3 | 点击「测试连接」 | 显示绿色 ✅ "连接成功" |
| J4 | 打开一个视频页面 | content.js 自动提取视频元信息 |
| J5 | 点击插件图标 | 弹窗显示视频标题/时长/来源 |
| J6 | 点击「检查是否重复」 | 展示去重结果（strong/medium/weak/none） |
| J7 | 未重复时点击「添加到库」 | 弹窗显示"已添加"，统计数据刷新 |

---

## K. IDM 桥接（可选，需 Windows + IDM）

| # | 场景 | 预期 |
|---|------|------|
| K1 | `python scripts/idm_bridge.py status` | `{"available": true}` |
| K2 | 触发下载 | IDM 弹出下载窗口 |
| K3 | 下载完成后等 5 分钟 | 后台截图任务自动执行 |

---

## 验收判定

| 模块 | 用例数 | 通过条件 |
|------|--------|----------|
| 环境 | 6 | 全部通过 |
| 鉴权 | 4 | 全部通过 |
| CRUD | 7 | 全部通过 |
| 去重 | 4 | 全部通过 |
| 搜索 | 3 | 全部通过 |
| 统计 | 1 | 通过 |
| 导入 | 2 | 全部通过 |
| 截图 | 4 | 全部通过 |
| 定时 | 2 | 全部通过 |
| 插件 | 7 | 全部通过 |
| IDM | 3 | 至少 K1 通过 |
| **总计** | **43** | **≥40 通过** |

---

## 快速一键验收脚本（PowerShell）

```powershell
# 保存为 test_acceptance.ps1，配置 API_KEY 后运行
$BASE = "http://127.0.0.1:18080"
$KEY = "你的API_KEY"
$HEADERS = @{ "X-API-Key" = $KEY; "Content-Type" = "application/json" }

Write-Host "=== B: Health ==="
Invoke-RestMethod "$BASE/health"

Write-Host "=== B: Auth Check ==="
try { Invoke-RestMethod "$BASE/api/v1/videos/stats" } catch { $_.Exception.Response.StatusCode }

Write-Host "=== C: Create Video ==="
$body = '{"url":"http://test.com/v/1","title":"验收测试视频","size_mb":100,"duration_secs":3600,"source_site":"test.com","download_path":"D:/Downloads/test.mp4"}'
Invoke-RestMethod "$BASE/api/v1/videos" -Method POST -Headers $HEADERS -Body $body

Write-Host "=== C: List Videos ==="
Invoke-RestMethod "$BASE/api/v1/videos" -Headers $HEADERS

Write-Host "=== D: Check Duplicate ==="
Invoke-RestMethod "$BASE/api/v1/videos/check?title=验收测试视频&duration_secs=3600&size_mb=100" -Headers $HEADERS

Write-Host "=== F: Stats ==="
Invoke-RestMethod "$BASE/api/v1/videos/stats" -Headers $HEADERS

Write-Host "=== H: Screenshot Pending ==="
Invoke-RestMethod "$BASE/api/v1/videos/screenshot/pending?limit=5" -Headers $HEADERS

Write-Host "Done."
```
