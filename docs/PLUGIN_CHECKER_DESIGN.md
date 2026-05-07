> **版本**: V1.1  
> **状态**: 设计阶段  
> **关联**: 需配合后端新增 `/api/v1/videos/lookup` 接口

---

# 轻量悬浮检查插件 — 技术实现方案

## 1. 架构设计

```
┌───────────────────────────────┐
│   Manifest V3 浏览器插件       │
│                               │
│   background.js (service worker)
│   ├─ tabs.onUpdated / onActivated → 取 URL
│   ├─ fetch → /api/v1/public/lookup（无需 API Key）
│   ├─ chrome.action.setBadgeText() + setBadgeBackgroundColor()
│   └─ chrome.tabs.sendMessage → 通知 content
│                               │
│   content.js                  │
│   ├─ 接收 background 消息      │
│   ├─ 检查是否在白名单中        │
│   └─ 注入/移除 页面悬浮标签    │
│                               │
│   options.html / options.js   │
│   └─ 白名单配置界面            │
└───────────────────────────────┘
         │
         │ HTTP (fetch, 无 API Key)
         ▼
┌───────────────────────────────┐
│   FastAPI Backend             │
│   (127.0.0.1:18080)           │
│                               │
│   GET /api/v1/public/lookup   │
│   └─ 公共路由，不需要 API Key │
│      仅 URL 精确 + 前缀匹配    │
│      返回 {exists, id, title}  │
└───────────────────────────────┘
```

## 2. 视觉反馈设计（双保险）

### 2a. 工具栏徽章 (Badge) — background.js 控制

| 状态 | setBadge | 效果 |
|------|----------|------|
| 已存在 | `text: "存"`, `color: #ff4d4f` | 🔴 红底白字 |
| 未收录 | `text: "新"`, `color: #52c41a` | 🟢 绿底白字 |
| 加载中 | 清除 badge | 无显示 |

> 即使不在白名单站点也显示 badge（因为 background 对所有页面都调 API）。如果用户希望非白名单不显示 badge，后续可加开关。

### 2b. 页面悬浮标签 — content.js 控制

| 状态 | 标签样式 | DOM |
|------|----------|-----|
| 已存在 | 🔴 `#ff4d4f` 背景 + 白字「已存在」 | `<div id="vds-checker-tag">已存在</div>` |
| 未收录 | 🟢 `#52c41a` 背景 + 白字「未收录」 | `<div id="vds-checker-tag">未收录</div>` |
| 非白名单 | 不注入 | 无 DOM |

标签规格：

```css
#vds-checker-tag {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 999999;
  padding: 4px 10px;
  border-radius: 4px;
  color: #fff;
  font-size: 12px;
  font-family: sans-serif;
  line-height: 1.5;
  pointer-events: none;   /* 不拦截点击 */
  user-select: none;       /* 不可选中 */
  box-shadow: 0 2px 6px rgba(0,0,0,0.2);
}
```

> 标签与 badge 颜色一致，用户视线无论落在页面内还是工具栏，都能立即识别。

## 2. 新增后端接口

> 新增**公共路由**（不需要 API Key），供 checker 插件使用。
> 
> 理由：`127.0.0.1` 是 loopback 地址外部不可访问；lookup 仅只读查询不涉及敏感操作；同机器其他进程本就有数据库直接访问权。

### `GET /api/v1/public/lookup`

**用途**：仅通过 URL 判断视频是否存在，无需鉴权，返回极简结果。

**请求**：

```
GET /api/v1/public/lookup?url=https://test.com/videos/abc
```

**响应**：

```json
{
  "exists": true,
  "id": 4359,
  "title": "Chinese math abc - video 12",
  "screenshot_path": "D:\\0_code\\vds-img\\video_4359_preview.jpg"
}
```

不存在时：

```json
{
  "exists": false,
  "id": null,
  "title": "",
  "screenshot_path": ""
}
```

**匹配逻辑**（简化版，比 check 轻 10 倍）：

```
① URL 完全一致 → exists=true
② URL 去尾部斜杠一致 → exists=true
③ URL 去查询参数一致 → exists=true
④ 以上全不匹配 → exists=false
```

**SQL 查询**：

```sql
SELECT id, title, screenshot_path FROM videos
WHERE is_deleted = 0
  AND (url = :url OR url = :url_clean OR url LIKE :url_base)
LIMIT 1;
```

**查询成本**：命中 `idx_videos_url` 索引，单行读，微秒级。

### 后端代码实现

**新文件** `api/v1/public.py`：

```python
# public.py — 无需 API Key 的公共端点
from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.video import Video

router = APIRouter(prefix='/api/v1/public', tags=['public'])


@router.get('/lookup')
def lookup_by_url(
    url: str = Query(..., description='页面完整 URL'),
    db: Session = Depends(get_db),
):
    url_clean = url.rstrip('/')
    url_base = url_clean.split('?')[0]

    record = db.query(Video).filter(
        Video.is_deleted == 0,
        or_(
            Video.url == url,
            Video.url == url_clean,
            Video.url.like(f"{url_base}%"),
        )
    ).first()

    if record:
        return {
            'exists': True,
            'id': record.id,
            'title': record.title,
            'screenshot_path': record.screenshot_path or '',
        }
    return {
        'exists': False,
        'id': None,
        'title': '',
        'screenshot_path': '',
    }
```

**修改** `api/router.py`：新增 `public_router` 引入。

## 3. 插件文件结构

```
extension/
├── checker/                    # 新插件，独立目录，独立打包
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── options.html
│   └── options.js
│
├── popup/                      # 主插件（现有，无变动）
│   ├── popup.html
│   ├── popup.js
│   └── ...
```

## 4. 核心文件详细设计

### 4.1 manifest.json

```json
{
  "manifest_version": 3,
  "name": "视频去重检查器",
  "version": "1.0.0",
  "description": "已收录自动显示「已存在」标签 + 工具栏红底「存」；未收录显示「未收录」绿标签 + 绿底「新」。",
  "permissions": [
    "storage",
    "activeTab"
  ],
  "host_permissions": [
    "http://127.0.0.1:18080/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "options_ui": {
    "page": "options.html",
    "open_in_tab": false
  },
  "icons": {
    "16": "icon16.png",
    "48": "icon48.png",
    "128": "icon128.png"
  }
}
```

### 4.2 background.js

```
职责：监听标签页切换/加载 → 调 API → 设徽章 → 通知 content
```

```javascript
const API_BASE = 'http://127.0.0.1:18080';
const TIMEOUT_MS = 3000;

// 标签页加载完成
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    checkUrl(tabId, tab.url);
  }
});

// 标签页切换
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (tab.url && tab.url.startsWith('http')) {
    checkUrl(tab.id, tab.url);
  }
});

async function checkUrl(tabId, url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(
      `${API_BASE}/api/v1/public/lookup?url=${encodeURIComponent(url)}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);

    if (!res.ok) throw new Error(`status ${res.status}`);

    const data = await res.json();

    // 设置工具栏徽章
    if (data.exists) {
      chrome.action.setBadgeText({ text: '存', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#ff4d4f', tabId });
    } else {
      chrome.action.setBadgeText({ text: '新', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#52c41a', tabId });
    }

    // 通知 content.js 更新页面悬浮标签
    chrome.tabs.sendMessage(tabId, {
      type: 'CHECK_RESULT',
      exists: data.exists,
      id: data.id,
      title: data.title,
    }).catch(() => { /* content 尚未注入，忽略 */ });
  } catch (err) {
    // 清理徽章 + 通知 content 隐藏标签
    chrome.action.setBadgeText({ text: '', tabId });
    chrome.tabs.sendMessage(tabId, { type: 'CHECK_RESULT', exists: null })
      .catch(() => {});
    console.debug('[checker] lookup error:', err.message);
  }
}
```

### 4.3 content.js

```
职责：接收 background 消息，控制页面内悬浮标签
```

```javascript
const TAG_ID = 'vds-checker-tag';
const STORAGE_KEY = 'vds_checker_whitelist';
const DEFAULT_SITES = [
  'thisvid.com', 'spankbang.com', 'xvideos.com',
  'pornhub.com',
];

function getDomain() { return window.location.hostname.replace(/^www\./, ''); }

function isWhitelisted(domains) {
  const cur = getDomain();
  return domains.some(d => cur === d || cur.endsWith('.' + d));
}

// 收到 background 结果
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'CHECK_RESULT') return;

  if (msg.exists === null) {
    // API 出错 → 隐藏标签
    removeTag();
    return;
  }

  chrome.storage.sync.get(STORAGE_KEY, (data) => {
    const whitelist = (data[STORAGE_KEY] || DEFAULT_SITES)
      .map(s => s.toLowerCase().trim()).filter(Boolean);
    if (!isWhitelisted(whitelist)) return;  // 不在白名单 → 不显示标签

    if (msg.exists) {
      showTag('已存在', '#ff4d4f');
    } else {
      showTag('未收录', '#52c41a');
    }
  });
});

function showTag(text, color) {
  let tag = document.getElementById(TAG_ID);
  if (tag) { tag.remove(); }  // 先移除旧的再重建，确保颜色正确

  tag = document.createElement('div');
  tag.id = TAG_ID;
  tag.textContent = text;
  tag.style.cssText = `
    position: fixed; top: 12px; right: 12px; z-index: 999999;
    padding: 4px 10px; border-radius: 4px;
    background: ${color}; color: #fff;
    font: 12px/1.5 sans-serif;
    pointer-events: none; user-select: none;
    box-shadow: 0 2px 6px rgba(0,0,0,0.2);
  `;
  document.body.appendChild(tag);
}

function removeTag() {
  const tag = document.getElementById(TAG_ID);
  if (tag) tag.remove();
}

// 页面离开时清理
window.addEventListener('beforeunload', removeTag);
```

### 4.4 options.html / options.js

```
用途：配置白名单站点
```

```html
<!DOCTYPE html>
<html>
<body>
  <h2>视频去重检查器 — 设置</h2>
  <label>允许的站点（每行一个域名）</label>
  <textarea id="sites" rows="8" style="width:100%"></textarea>
  <button id="save">保存</button>
  <p id="status"></p>
</body>
</html>
```

```javascript
const STORAGE_KEY = 'vds_checker_whitelist';
const DEFAULT_SITES = ['thisvid.com','spankbang.com','xvideos.com','pornhub.com','test.com'];

const el = document.getElementById('sites');
const status = document.getElementById('status');

chrome.storage.sync.get(STORAGE_KEY, (data) => {
  el.value = (data[STORAGE_KEY] || DEFAULT_SITES).join('\n');
});

document.getElementById('save').onclick = () => {
  const list = el.value.split('\n').map(s => s.trim()).filter(Boolean);
  chrome.storage.sync.set({ [STORAGE_KEY]: list }, () => {
    status.textContent = '✅ 已保存';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
};
```

## 5. 双保险视觉反馈总结

```
                    ┌──────────┐          ┌──────┐
  已收录 (exists)    │ 已存在   │  (页面)   │ 存   │  (工具栏)
                    └──────────┘          └──────┘
                    🟥 红底白字           🔴 红底白字

                    ┌──────────┐          ┌──────┐
  未收录 (!exists)   │ 未收录   │  (页面)   │ 新   │  (工具栏)
                    └──────────┘          └──────┘
                    🟩 绿底白字           🟢 绿底白字

  API 出错 → 两者都清除，不留痕迹
```

## 6. 白名单机制说明

| 阶段 | 文件名 | 逻辑 |
|------|--------|------|
| 插件安装 | `options.html` | 用户可自行添加/删除站点域名 |
| 页面加载 | `content.js` | 从 `chrome.storage.sync` 读取白名单 |
| URL 检测 | `background.js` | **全部 URL 都调 API**（不依赖白名单） |
| 悬浮显示 | `content.js` | **只有白名单站点才显示**红点/绿点 |

> 白名单只控制「是否显示红点」，不控制「是否调 API」——background 对所有页面调 API 但只有白名单页面上的红点才显示。切换白名单无需重启浏览器。

## 7. 与主插件的差异对比

| 维度 | 主插件 (video-dedup) | 检查器 (video-dedup-checker) |
|------|---------------------|------------------------------|
| Manifest | MV3 | MV3 |
| popup | ✅ 完整交互（查重/入库/补全/导入） | ❌ 无 popup（纯自动） |
| content | 扫描页面上视频元素 | 显示「已存在」「未收录」悬浮标签 |
| background | 消息桥接 + API 调用 | API 调用 + 设 Badge + 通知 content |
| storage | 多键（规则/状态） | 仅白名单 |
| 后端依赖 | 全部 API | 仅 `/lookup` 一个接口 |

## 8. 开发步骤

| 步骤 | 内容 | 涉及文件 |
|------|------|----------|
| 1 | 后端 public 路由 + lookup 接口 | `api/v1/public.py`（新）|
| 2 | 注册路由 | `api/router.py` |
| 3 | 插件 manifest | `extension/checker/manifest.json` |
| 4 | background（API + Badge） | `background.js` |
| 5 | content（页面悬浮标签） | `content.js` |
| 6 | 选项页（白名单配置） | `options.html`, `options.js` |
| 7 | 联调测试 | 白名单配置 → 打开页面 → 看标签 + 徽章 |
| 8 | 打包 | Chrome 开发者模式加载已解压扩展 |

## 9. 可选增强（Phase 2）

- [ ] 悬浮标签点击弹出小卡片（标题、ID、大小、截图预览）
- [ ] 右键菜单「查看详情」跳转到主插件
- [ ] 跨标签页状态同步
- [ ] 非白名单站点也显示 badge 的开关选项
