// video-dedup-checker — options.js
// 白名单配置页面逻辑

const STORAGE_KEY = 'vds_checker_whitelist';

const DEFAULT_SITES = [
  'thisvid.com',
  'spankbang.com',
  'xvideos.com',
  'pornhub.com',
];

const el = document.getElementById('sites');
const statusEl = document.getElementById('status');

// ── 加载已保存的配置 ──
chrome.storage.sync.get(STORAGE_KEY, (data) => {
  el.value = (data[STORAGE_KEY] || DEFAULT_SITES).join('\n');
});

// ── 保存 ──
document.getElementById('save').addEventListener('click', () => {
  const list = el.value
    .split('\n')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  chrome.storage.sync.set({ [STORAGE_KEY]: list }, () => {
    statusEl.textContent = '✅ 已保存';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  });
});
