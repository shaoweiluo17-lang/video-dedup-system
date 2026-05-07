// video-dedup-checker — background.js
// 监听标签页事件 → 调 public lookup（无需 API Key）→ 设 Badge → 通知 content

const API_BASE = 'http://127.0.0.1:18080';
const TIMEOUT_MS = 3000;
const LOOKUP_URL = API_BASE + '/api/v1/public/lookup';

// ── 标签页加载完成 ──
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    checkUrl(tabId, tab.url);
  }
});

// ── 标签页切换 ──
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  if (tab.url && tab.url.startsWith('http')) {
    checkUrl(tab.id, tab.url);
  }
});

// ── 核心：查 URL 是否存在 ──
async function checkUrl(tabId, url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(
      `${LOOKUP_URL}?url=${encodeURIComponent(url)}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!res.ok) throw new Error(`status ${res.status}`);

    const data = await res.json();

    // 设工具栏徽章
    if (data.exists) {
      chrome.action.setBadgeText({ text: '存', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#ff4d4f', tabId });
    } else {
      chrome.action.setBadgeText({ text: '新', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#52c41a', tabId });
    }

    // 通知 content.js 显示页面标签
    chrome.tabs.sendMessage(tabId, {
      type: 'CHECK_RESULT',
      exists: data.exists,
      id: data.id,
      title: data.title,
    }).catch(() => { /* content 可能还没注入，忽略 */ });
  } catch (err) {
    // API 不可达 → 清除 badge + 通知 content 隐藏标签
    chrome.action.setBadgeText({ text: '', tabId });
    chrome.tabs.sendMessage(tabId, { type: 'CHECK_RESULT', exists: null })
      .catch(() => {});
    console.debug('[vds-checker] lookup error:', err.message);
  }
}
