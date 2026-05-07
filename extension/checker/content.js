// video-dedup-checker — content.js
// 1) 接收 background 消息 → 显示/隐藏页面左上角「已存在」/「未收录」标签
// 2) 右键菜单扫描 → 批量查重 → 标注链接

// ════════════════════════════════════════════
// 配置
// ════════════════════════════════════════════

const TAG_ID = 'vds-checker-tag';
const SCAN_TAG_CLASS = 'vds-scan-tag';
const STORAGE_KEY = 'vds_checker_whitelist';

const DEFAULT_SITES = [
  'thisvid.com',
  'spankbang.com',
  'xvideos.com',
  'pornhub.com',
];

const API_BASE = 'http://127.0.0.1:18080';
const LOOKUP_BATCH_URL = API_BASE + '/api/v1/public/lookup-batch';

// ════════════════════════════════════════════
// 状态
// ════════════════════════════════════════════

let __scanTarget = null;          // 最近右键的目标元素
const urlCache = new Map();       // url → {exists, id}（页面级别缓存）

// ════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════

function getDomain() {
  return window.location.hostname.replace(/^www\./, '');
}

function isWhitelisted(domains) {
  const cur = getDomain();
  return domains.some(d => cur === d || cur.endsWith('.' + d));
}

// ════════════════════════════════════════════
// 1) 右键拦截 — 记录目标元素
// ════════════════════════════════════════════

document.addEventListener('contextmenu', (e) => {
  __scanTarget = e.target;
}, true);  // capture phase，优先执行

// ════════════════════════════════════════════
// 2) 消息分发
// ════════════════════════════════════════════

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

// ════════════════════════════════════════════
// 3) CHECK_RESULT — 页面左上角标签（已有）
// ════════════════════════════════════════════

function handleCheckResult(msg) {
  if (msg.exists === null) {
    removeTag();
    return;
  }

  chrome.storage.sync.get(STORAGE_KEY, (data) => {
    const whitelist = (data[STORAGE_KEY] || DEFAULT_SITES)
      .map(s => s.toLowerCase().trim())
      .filter(Boolean);

    if (!isWhitelisted(whitelist)) return;

    showTag(msg.exists ? '已存在' : '未收录', msg.exists ? '#ff4d4f' : '#52c41a');
  });
}

function showTag(text, color) {
  let tag = document.getElementById(TAG_ID);
  if (tag) tag.remove();

  tag = document.createElement('div');
  tag.id = TAG_ID;
  tag.textContent = text;
  tag.style.cssText = `
    position: fixed;
    top: 12px;
    left: 12px;
    right: auto;
    z-index: 999999;
    padding: 4px 10px;
    border-radius: 4px;
    background: ${color};
    color: #fff;
    font: 12px/1.5 sans-serif;
    pointer-events: none;
    user-select: none;
    box-shadow: 0 2px 6px rgba(0,0,0,0.2);
  `;
  document.body.appendChild(tag);
}

function removeTag() {
  const tag = document.getElementById(TAG_ID);
  if (tag) tag.remove();
}

window.addEventListener('beforeunload', removeTag);

// ════════════════════════════════════════════
// 4) DO_SCAN — 批量扫描 + 标注
// ════════════════════════════════════════════

async function handleScan() {
  if (!__scanTarget) __scanTarget = document.body;

  // 只在 div.thumbs-items 内生效
  const container = __scanTarget.closest('div.thumbs-items');
  if (!container) {
    console.debug('[vds-checker] 右键目标不在 div.thumbs-items 内，跳过扫描');
    return;
  }

  // 提取所有 <a> 链接
  const links = container.querySelectorAll('a[href^="http"]');
  const allUrls = Array.from(links).map(a => a.href);
  const uniqueUrls = [...new Set(allUrls)].filter(h => h.startsWith('http')).slice(0, 200);

  if (uniqueUrls.length === 0) return;

  // 区分已缓存和未缓存
  const uncached = uniqueUrls.filter(url => !urlCache.has(url));

  if (uncached.length > 0) {
    try {
      const res = await fetch(LOOKUP_BATCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: uncached }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = await res.json();

      for (const [url, result] of Object.entries(data.results)) {
        urlCache.set(url, result);
      }
    } catch (err) {
      console.debug('[vds-checker] batch lookup error:', err.message);
      for (const url of uncached) {
        urlCache.set(url, { exists: null, id: null });
      }
    }
  }

  // 渲染标注
  annotateLinks(links, uniqueUrls);
}

// ════════════════════════════════════════════
// 5) 标注渲染
// ════════════════════════════════════════════

function annotateLinks(links, targetUrls) {
  const urlSet = new Set(targetUrls);

  links.forEach(a => {
    if (!urlSet.has(a.href)) return;
    // 跳过已标注的（保护）
    if (a.nextElementSibling && a.nextElementSibling.classList.contains(SCAN_TAG_CLASS)) return;

    const result = urlCache.get(a.href);
    const tag = document.createElement('span');
    tag.className = SCAN_TAG_CLASS;

    let bg, text;
    if (result && result.exists === true) {
      bg = '#ff4d4f';
      text = `✔ #${result.id}`;
    } else if (result && result.exists === false) {
      bg = '#52c41a';
      text = '✚';
    } else {
      bg = '#999';
      text = '⚠';
    }

    tag.textContent = text;
    tag.style.cssText = `
      display: inline-block;
      font: 11px/1.4 sans-serif;
      padding: 1px 5px;
      margin-left: 4px;
      border-radius: 3px;
      background: ${bg};
      color: #fff;
      user-select: none;
    `;

    a.parentNode.insertBefore(tag, a.nextSibling);
  });
}

// ════════════════════════════════════════════
// 6) 清除标注
// ════════════════════════════════════════════

function clearAnnotations() {
  document.querySelectorAll('.' + SCAN_TAG_CLASS).forEach(el => el.remove());
  // 不清缓存，再次扫描直接复用
}
