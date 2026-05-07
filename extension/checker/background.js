// video-dedup-checker — background.js
// 1) 标签页监听 → 调 lookup → 设 Badge → 通知 content
// 2) 右键菜单 → 批量扫描 → 转发消息到 content

const API_BASE = 'http://127.0.0.1:18080';
const TIMEOUT_MS = 3000;
const LOOKUP_URL = API_BASE + '/api/v1/public/lookup';

// ════════════════════════════════════════════
// 1) 页面自动查重（已有功能）
// ════════════════════════════════════════════

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    checkUrl(tabId, tab.url);
  }
});

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
      `${LOOKUP_URL}?url=${encodeURIComponent(url)}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!res.ok) throw new Error(`status ${res.status}`);

    const data = await res.json();

    if (data.exists) {
      chrome.action.setBadgeText({ text: '存', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#ff4d4f', tabId });
    } else {
      chrome.action.setBadgeText({ text: '新', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#52c41a', tabId });
    }

    chrome.tabs.sendMessage(tabId, {
      type: 'CHECK_RESULT',
      exists: data.exists,
      id: data.id,
    }).catch(() => {});
  } catch (err) {
    chrome.action.setBadgeText({ text: '', tabId });
    chrome.tabs.sendMessage(tabId, { type: 'CHECK_RESULT', exists: null })
      .catch(() => {});
    console.debug('[vds-checker] lookup error:', err.message);
  }
}

// ════════════════════════════════════════════
// 2) 右键菜单 — 批量扫描（新增功能）
// ════════════════════════════════════════════

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

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const type = info.menuItemId === 'vds-scan-area' ? 'DO_SCAN' : 'CLEAR_SCAN';
  chrome.tabs.sendMessage(tab.id, { type }).catch(() => {});
});
