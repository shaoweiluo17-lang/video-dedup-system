/**
 * Popup 交互脚本
 */
'use strict';

// ----- DOM 引用 -----
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  vTitle: $('#vTitle'),
  vDuration: $('#vDuration'),
  vSource: $('#vSource'),
  videoInfoNone: $('#videoInfoNone'),
  videoInfoContent: $('#videoInfoContent'),
  btnCheck: $('#btnCheck'),
  btnAdd: $('#btnAdd'),
  btnRefresh: $('#btnRefresh'),
  resultSection: $('#resultSection'),
  resultTitle: $('#resultTitle'),
  resultContent: $('#resultContent'),
  statsContent: $('#statsContent'),
  statusBar: $('#statusBar'),
};

// ----- 状态 -----
let currentVideo = null;
let lastCheckResult = null;

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
  await scanPage();
  await loadStats();
  bindEvents();
});

// ==================== 页面扫描 ====================
async function scanPage() {
  setStatus('扫描页面视频信息...');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showNoVideo();
      return;
    }
    const resp = await chrome.tabs.sendMessage(tab.id, { action: 'extractVideoInfo' });
    if (resp && resp.title) {
      currentVideo = resp;
      renderVideoInfo(resp);
      setStatus('已检测到视频');
    } else {
      showNoVideo();
    }
  } catch (e) {
    showNoVideo();
    setStatus('请刷新视频页面后重试');
  }
}

function renderVideoInfo(info) {
  els.videoInfoNone.classList.add('hidden');
  els.videoInfoContent.classList.remove('hidden');
  els.vTitle.textContent = info.title || '(无标题)';
  els.vDuration.textContent = info.duration_str
    ? `${info.duration_str} (${info.duration_secs}秒)`
    : '未知';
  els.vSource.textContent = info.source_site || '未知';

  // 显示预览图
  const existingImg = els.videoInfoContent.querySelector('.preview-thumb');
  if (existingImg) existingImg.remove();
  if (info.preview_url) {
    const img = document.createElement('img');
    img.className = 'preview-thumb';
    img.src = info.preview_url;
    img.style.cssText = 'max-width:100%;max-height:120px;margin-top:8px;border-radius:6px;display:block;';
    img.onerror = () => img.remove();
    els.videoInfoContent.appendChild(img);
  }
}

function showNoVideo() {
  els.videoInfoContent.classList.add('hidden');
  els.videoInfoNone.classList.remove('hidden');
  currentVideo = null;
}

// ==================== 操作 ====================
function bindEvents() {
  els.btnCheck.addEventListener('click', handleCheck);
  els.btnAdd.addEventListener('click', handleAdd);
  els.btnRefresh.addEventListener('click', async () => {
    await scanPage();
    await loadStats();
    els.resultSection.classList.add('hidden');
    els.btnAdd.classList.add('hidden');
  });
}

async function handleCheck() {
  if (!currentVideo) {
    setStatus('未检测到视频信息');
    return;
  }

  els.btnCheck.disabled = true;
  setStatus('正在检查...');

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'checkDuplicate',
      title: currentVideo.title,
      duration_secs: currentVideo.duration_secs,
      size_mb: currentVideo.size_mb,
      source_site: currentVideo.source_site,
    });

    if (result.error) throw new Error(result.error);

    lastCheckResult = result;
    renderResult(result);

    if (result.exists) {
      setStatus(`发现 ${result.level} 级别匹配`);
      els.btnAdd.classList.add('hidden');
    } else {
      setStatus('✅ 未发现重复');
      els.btnAdd.classList.remove('hidden');
    }
  } catch (e) {
    setStatus(`检查失败: ${e.message}`);
    els.resultSection.classList.add('hidden');
  } finally {
    els.btnCheck.disabled = false;
  }
}

function renderResult(result) {
  els.resultSection.classList.remove('hidden');
  els.resultContent.innerHTML = '';

  if (!result.exists) {
    els.resultTitle.textContent = '📊 检查结果：未发现重复';
    els.resultContent.innerHTML = '<div class="status-bar" style="color:#22c55e;">✅ 安全，可以下载</div>';
    return;
  }

  const levelLabel = {
    strong: '高置信重复',
    medium: '中置信重复',
    weak: '低置信匹配',
  };
  const levelClass = {
    strong: 'strong',
    medium: 'medium',
    weak: 'weak',
  };
  const badgeClass = {
    strong: 'badge-red',
    medium: 'badge-yellow',
    weak: 'badge-blue',
  };

  els.resultTitle.innerHTML = `📊 检查结果：<span class="badge ${badgeClass[result.level] || 'badge-blue'}">${levelLabel[result.level] || result.level}</span>`;

  const card = document.createElement('div');
  card.className = `result-card ${levelClass[result.level] || ''}`;
  card.innerHTML = (result.matches || [])
    .map(
      (m) => `
      <div class="match-item">
        <div style="font-weight:600;">${escapeHtml(m.title)}</div>
        <div style="color:#888;">
          时长: ${m.duration_secs}s | 大小: ${m.size_mb}MB | 路径: ${escapeHtml(m.download_path || '-')}
        </div>
        ${m.preview_path ? `<div style="font-size:11px;color:#666;">🌐 网页预览: ${escapeHtml(m.preview_path.split('/').pop() || m.preview_path)}</div>` : ''}
        ${m.screenshot_path ? `<div style="font-size:11px;color:#666;">🎬 视频截图: ${escapeHtml(m.screenshot_path.split('/').pop() || m.screenshot_path)}</div>` : ''}
        <div style="font-size:10px;color:#aaa;">相似度: ${(m.score * 100).toFixed(0)}%</div>
      </div>`
    )
    .join('');
  els.resultContent.appendChild(card);
}

async function handleAdd() {
  if (!currentVideo) return;

  els.btnAdd.disabled = true;
  setStatus('正在添加到库...');

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'addVideo',
      url: currentVideo.url,
      title: currentVideo.title,
      duration_secs: currentVideo.duration_secs,
      duration_str: currentVideo.duration_str,
      size_mb: currentVideo.size_mb,
      category: currentVideo.category,
      source_site: currentVideo.source_site,
      preview_url: currentVideo.preview_url || '',
    });

    if (result.error) throw new Error(result.error);
    setStatus('✅ 已添加到视频库');
    els.btnAdd.classList.add('hidden');
    await loadStats();
  } catch (e) {
    setStatus(`添加失败: ${e.message}`);
  } finally {
    els.btnAdd.disabled = false;
  }
}

// ==================== 统计 ====================
async function loadStats() {
  try {
    const result = await chrome.runtime.sendMessage({ action: 'getStats' });
    if (result.error) throw new Error(result.error);

    const totalSize = result.total_size_mb
      ? (Number(result.total_size_mb) / 1024).toFixed(1)
      : '0';
    els.statsContent.innerHTML = `
      <div class="stats-item">
        <div class="stats-num">${result.total_videos || 0}</div>
        <div>视频数</div>
      </div>
      <div class="stats-item">
        <div class="stats-num">${totalSize}</div>
        <div>总大小(GB)</div>
      </div>
      <div class="stats-item">
        <div class="stats-num">${result.pending_screenshot || 0}</div>
        <div>待截图</div>
      </div>
    `;
  } catch (e) {
    els.statsContent.innerHTML = '<span style="color:#ef4444;">获取统计失败</span>';
    console.error('stats error:', e);
  }
}

// ==================== 工具 ====================
function setStatus(msg) {
  els.statusBar.textContent = msg;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
