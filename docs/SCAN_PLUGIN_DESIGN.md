> **版本**: V1.0  
> **状态**: 设计阶段  
> **关联**: 合并到现有 checker 插件，增强右键批量扫描功能

---

# 右键批量扫描插件 — 技术实现方案

## 1. 架构概览

```
┌──────────────────────────────────────────────────┐
│              checker 插件（增强版）               │
│                                                    │
│  background.js                                     │
│  ├─ 已有：标签页切换 → lookup → badge             │
│  └─ 新增：contextMenus 注册 + onClicked 转发      │
│                                                    │
│  content.js                                        │
│  ├─ 已有：显示/隐藏页面左上角标签                  │
│  ├─ 新增：contextmenu 拦截 → 记录目标元素          │
│  ├─ 新增：DO_SCAN 消息处理 → 提取链接 → 调 API    │
│  └─ 新增：标注渲染 + 清除                          │
│                                                    │
│  manifest.json                                     │
│  └─ 新增：permissions: "contextMenus"              │
└──────────────────────────────────────────────────┘
         │
         │ POST /api/v1/public/lookup-batch
         ▼
┌──────────────────────────────────────────────────┐
│  FastAPI Backend                                  │
│  public.py                                        │
│  ├─ 已有：GET /api/v1/public/lookup              │
│  └─ 新增：POST /api/v1/public/lookup-batch       │
└──────────────────────────────────────────────────┘
```

## 2. 后端新增接口

### `POST /api/v1/public/lookup-batch`

**请求：**

```json
POST /api/v1/public/lookup-batch
Content-Type: application/json

{
  "urls": [
    "https://example.com/video/123",
    "https://example.com/video/456"
  ]
}
```

**响应：**

```json
{
  "results": {
    "https://example.com/video/123": { "exists": true, "id": 4359 },
    "https://example.com/video/456": { "exists": false, "id": null }
  }
}
```

**后端实现要点：**

- 先对全部 URL 做**精确匹配**（`IN` 查询），一次查出所有 exact match
- 剩余未匹配的 URL 逐个做 clean/base 降噪匹配
- 最大处理 200 个 URL（输入限制）
- 针对 `idx_videos_url` 索引，单次查询微秒级

```python
@router.post('/lookup-batch')
def lookup_batch(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    urls = payload.get('urls', [])[:200]
    # step 1: 精确匹配（批量）
    exact_records = db.query(Video).filter(
        Video.is_deleted == 0,
        Video.url.in_(urls),
    ).all()
    url_to_record = {r.url: r for r in exact_records}
    
    results = {}
    for url in urls:
        if url in url_to_record:
            r = url_to_record[url]
            results[url] = {'exists': True, 'id': r.id}
        else:
            # step 2: 降噪匹配
            url_clean = url.rstrip('/')
            url_base = url_clean.split('?')[0]
            record = db.query(Video).filter(
                Video.is_deleted == 0,
                or_(Video.url == url_clean, Video.url.like(f"{url_base}%")),
            ).first()
            if record:
                results[url] = {'exists': True, 'id': record.id}
            else:
                results[url] = {'exists': False, 'id': None}
    
    return {'results': results}
```

## 3. 插件改动清单

### 3.1 manifest.json — 新增 contextMenus 权限

```json
{
  "permissions": [
    "storage",
    "activeTab",
    "contextMenus"
  ]
}
```

### 3.2 background.js — 新增上下文菜单

```javascript
// ── 注册右键菜单 ──
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'vds-scan-area',
    title: '🔍 扫描此区域所有链接',
    contexts: ['all'],
  });
  chrome.contextMenus.create({
    id: 'vds-clear-annotations',
    title: '🧹 清除此区域标注',
    contexts: ['all'],
  });
});

// ── 右键菜单点击处理 ──
chrome.contextMenus.onClicked.addListener((info, tab) => {
  chrome.tabs.sendMessage(tab.id, {
    type: info.menuItemId === 'vds-scan-area' ? 'DO_SCAN' : 'CLEAR_SCAN',
  }).catch(() => {});
});
```

### 3.3 content.js — 新增扫描逻辑

**3.3.1 右键拦截 → 记录目标元素**

```javascript
// ── 右键拦截：记录用户在哪个元素上右键 ──
let __scanTarget = null;

document.addEventListener('contextmenu', (e) => {
  // 记录最近右键的目标元素
  __scanTarget = e.target;
}, true);  // 使用 capture 确保优先执行
```

**3.3.2 处理 DO_SCAN 消息**

```javascript
// ── URL 缓存（页面级别） ──
const urlCache = new Map();  // url -> {exists, id}
const SCAN_TAG_CLASS = 'vds-scan-tag';

// ── 监听 background 消息 ──
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'CHECK_RESULT':
      handleCheckResult(msg);
      break;
    case 'DO_SCAN':
      handleScan();
      break;
    case 'CLEAR_SCAN':
      clearAnnotations();
      break;
  }
});
```

**3.3.3 扫描核心逻辑**

```javascript
async function handleScan() {
  if (!__scanTarget) {
    __scanTarget = document.body;  // fallback
  }

  // 找到目标容器（向上查找，最多 5 层）
  let container = __scanTarget.closest('div.thumbs-items');
  if (!container) {
    // 如果不在目标 div 内，就用右键元素本身
    container = __scanTarget;
  }

  // 提取所有 <a> 链接
  const links = container.querySelectorAll('a[href^="http"]');
  const urls = [...new Set(
    Array.from(links).map(a => a.href).filter(h => h.startsWith('http'))
  )].slice(0, 200);  // 最多 200

  if (urls.length === 0) return;

  // 区分已缓存和未缓存的 URL
  const uncached = urls.filter(url => !urlCache.has(url));

  if (uncached.length > 0) {
    // 批量查询后端
    try {
      const res = await fetch(LOOKUP_BATCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: uncached }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();
      // 写入缓存
      for (const [url, result] of Object.entries(data.results)) {
        urlCache.set(url, result);
      }
    } catch (err) {
      console.debug('[vds-checker] batch lookup error:', err.message);
      // 出错时未缓存的 URL 标记为 error
      for (const url of uncached) {
        urlCache.set(url, { exists: null, id: null });
      }
    }
  }

  // 渲染标注
  annotateLinks(links, urls);
}
```

**3.3.4 标注渲染**

```javascript
function annotateLinks(links, targetUrls) {
  const urlSet = new Set(targetUrls);

  links.forEach(a => {
    if (!urlSet.has(a.href)) return;
    // 跳过已标注的
    if (a.nextElementSibling && a.nextElementSibling.classList.contains(SCAN_TAG_CLASS)) return;

    const result = urlCache.get(a.href);
    const tag = document.createElement('span');
    tag.className = SCAN_TAG_CLASS;
    
    if (result && result.exists) {
      tag.textContent = `✔ #${result.id}`;
      tag.style.cssText = 'display:inline-block;font:11px/1.4 sans-serif;padding:1px 5px;margin-left:4px;border-radius:3px;background:#ff4d4f;color:#fff;';
    } else if (result && result.exists === false) {
      tag.textContent = '✚';
      tag.style.cssText = 'display:inline-block;font:11px/1.4 sans-serif;padding:1px 5px;margin-left:4px;border-radius:3px;background:#52c41a;color:#fff;';
    } else {
      tag.textContent = '⚠';
      tag.style.cssText = 'display:inline-block;font:11px/1.4 sans-serif;padding:1px 5px;margin-left:4px;border-radius:3px;background:#999;color:#fff;';
    }

    a.parentNode.insertBefore(tag, a.nextSibling);
  });
}
```

**3.3.5 清除标注**

```javascript
function clearAnnotations() {
  document.querySelectorAll('.' + SCAN_TAG_CLASS).forEach(el => el.remove());
}
```

## 4. 完整数据流

```
用户操作 → 右键目标区域
  ↓
contextmenu 事件 → content.js 记录 e.target（capture 阶段）
  ↓
Chrome 显示原生右键菜单
  ↓
用户点击「🔍 扫描此区域所有链接」
  ↓
background.contextMenus.onClicked → sendMessage({type:'DO_SCAN'})
  ↓
content.js 收到 DO_SCAN
  ↓
从 __scanTarget.closest('div.thumbs-items') 找容器
  ↓
links = container.querySelectorAll('a[href^="http"]')
  ↓
去重 → 过滤已缓存 → 剩余调 API
  ↓
POST /api/v1/public/lookup-batch
  ↓
写入 urlCache Map
  ↓
遍历 links → 在每个 <a> 后插入标注 span
```

## 5. 合并后插件文件变更

| 文件 | 变更说明 |
|------|----------|
| `manifest.json` | 新增 `contextMenus` 权限 |
| `background.js` | 新增 `contextMenus.create` + `onClicked` |
| `content.js` | 新增扫描/标注/清除逻辑（约 120 行） |
| `public.py` | 新增 `POST /lookup-batch` 批量接口 |

## 6. 注意事项

1. **右键菜单始终显示**：无法根据右键目标动态隐藏，用户在任意页面都能看到菜单项，但只有目标页面上操作才有意义
2. **content.js 注入时间**：`document_idle` 确保 DOM 就绪
3. **CSS 隔离**：标注使用 `span.vds-scan-tag` 类名，避免和页面样式冲突
4. **缓存用途**：同页面同 URL 多次出现不重复请求；清除标注不清缓存，重新扫描立即复用
