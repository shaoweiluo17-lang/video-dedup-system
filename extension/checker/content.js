// video-dedup-checker — content.js
// 接收 background 消息 → 在页面右上角显示「已存在」/「未收录」标签

const TAG_ID = 'vds-checker-tag';
const STORAGE_KEY = 'vds_checker_whitelist';

// 默认白名单（用户可在选项页修改）
const DEFAULT_SITES = [
  'thisvid.com',
  'spankbang.com',
  'xvideos.com',
  'pornhub.com',
];

// ── 工具 ──
function getDomain() {
  return window.location.hostname.replace(/^www\./, '');
}

function isWhitelisted(domains) {
  const cur = getDomain();
  return domains.some(d => cur === d || cur.endsWith('.' + d));
}

// ── 监听 background 消息 ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'CHECK_RESULT') return;

  if (msg.exists === null) {
    // API 出错 → 隐藏标签
    removeTag();
    return;
  }

  // 读取白名单（异步）
  chrome.storage.sync.get(STORAGE_KEY, (data) => {
    const whitelist = (data[STORAGE_KEY] || DEFAULT_SITES)
      .map(s => s.toLowerCase().trim())
      .filter(Boolean);

    if (!isWhitelisted(whitelist)) return;  // 不在白名单 → 不显示

    if (msg.exists) {
      showTag('已存在', '#ff4d4f');
    } else {
      showTag('未收录', '#52c41a');
    }
  });
});

// ── 显示悬浮标签 ──
function showTag(text, color) {
  let tag = document.getElementById(TAG_ID);
  if (tag) tag.remove();  // 移除旧的（切换状态时颜色正确）

  tag = document.createElement('div');
  tag.id = TAG_ID;
  tag.textContent = text;

  tag.style.cssText = `
    position: fixed;
    top: 12px;
    right: 12px;
    left: auto;
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

// ── 移除标签 ──
function removeTag() {
  const tag = document.getElementById(TAG_ID);
  if (tag) tag.remove();
}

// 页面关闭时清理
window.addEventListener('beforeunload', removeTag);
