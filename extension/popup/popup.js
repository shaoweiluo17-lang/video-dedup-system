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
  vDownloadPath: $('#vDownloadPath'),
  vSizeMb: $('#vSizeMb'),
  videoInfoNone: $('#videoInfoNone'),
  videoInfoContent: $('#videoInfoContent'),
  btnCheck: $('#btnCheck'),
  btnAdd: $('#btnAdd'),
  btnRefresh: $('#btnRefresh'),
  btnScanDir: $('#btnScanDir'),
  vImportDir: $('#vImportDir'),
  importStatus: $('#importStatus'),
  resultSection: $('#resultSection'),
  resultTitle: $('#resultTitle'),
  resultContent: $('#resultContent'),
  statsContent: $('#statsContent'),
  statusBar: $('#statusBar'),
};

// ----- 状态 -----
let currentVideo = null;
let lastCheckResult = null;

// ==================== 文件大小自动检测 ====================
async function detectFileSize() {
  const path = (els.vDownloadPath.value || '').trim();
  if (!path) { els.vSizeMb.placeholder = '自动检测'; return; }
  els.vSizeMb.placeholder = '检测中...';
  try {
    const r = await fetch(`http://127.0.0.1:18080/api/v1/utils/file-info?path=${encodeURIComponent(path)}`);
    const data = await r.json();
    if (data.exists) {
      els.vSizeMb.value = data.size_mb;
      els.vSizeMb.placeholder = `✅ ${data.size_mb} MB`;
    } else {
      els.vSizeMb.value = '';
      els.vSizeMb.placeholder = '❌ 文件不存在';
    }
  } catch (_) {
    els.vSizeMb.placeholder = '⚠ 无法连接服务器';
  }
}

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
  els.vDownloadPath.value = '';
  els.vSizeMb.value = '';
  els.vSizeMb.placeholder = '自动检测';
  els.resultSection.classList.add('hidden');
  els.btnAdd.classList.add('hidden');

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
  els.btnScanDir.addEventListener('click', handleScanDir);
  els.vDownloadPath.addEventListener('blur', detectFileSize);
  els.vDownloadPath.addEventListener('change', detectFileSize);
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
      url: currentVideo.url,
      title: currentVideo.title,
      duration_secs: currentVideo.duration_secs,
      size_mb: currentVideo.size_mb,
      source_site: currentVideo.source_site,
    });

    if (result.error) throw new Error(result.error);

    lastCheckResult = result;
    renderResult(result);

    if (result.exists) {
      // 只有 URL 完全一致 (score ≥ 0.99) 才禁止入库
      const hasUrlMatch = (result.matches || []).some(m => m.score >= 0.99);
      if (hasUrlMatch) {
        setStatus('🔴 URL 完全一致 — 已存在');
        els.btnAdd.classList.add('hidden');
      } else {
        setStatus(`⚠ ${levelLabel[result.level] || result.level}匹配 — 可能不重复`);
        els.btnAdd.classList.remove('hidden');
      }
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
      <div class="match-item" id="match-${m.id}">
        <div style="font-weight:600;">${escapeHtml(m.title)}</div>
        <div style="color:#888;">
          ${m.duration_str ? `⏱ ${escapeHtml(m.duration_str)}` : (m.duration_secs ? `⏱ ${m.duration_secs}s` : '')}
          ${m.size_mb && m.size_mb > 0 ? ` | 📦 ${Number(m.size_mb).toFixed(0)}MB` : ''}
          ${m.download_path ? ` | 📁 ${escapeHtml(m.download_path)}` : ' | ⚠ 未下载'}
        </div>
        ${m.preview_path ? `<img src="http://127.0.0.1:18080/screenshots/${encodeURIComponent(filenameFromPath(m.preview_path))}" style="max-width:100%;max-height:80px;margin-top:4px;border-radius:4px;" onerror="this.style.display='none'" /><div style="font-size:10px;color:#888;">🌐 网页预览</div>` : ''}
        ${m.screenshot_path ? `<img src="http://127.0.0.1:18080/screenshots/${encodeURIComponent(filenameFromPath(m.screenshot_path))}" style="max-width:100%;max-height:80px;margin-top:4px;border-radius:4px;" onerror="this.style.display='none'" /><div style="font-size:10px;color:#888;">🎬 视频截图</div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:10px;color:#aaa;">相似度: ${(m.score * 100).toFixed(0)}%</span>
          <button class="btn-update-match" data-id="${m.id}" style="font-size:10px;padding:2px 8px;background:#f59e0b;color:#fff;border:none;border-radius:3px;cursor:pointer;">📥 补全</button>
        </div>
      </div>`
    )
    .join('');
  els.resultContent.appendChild(card);

  // 事件代理：点每条匹配的「补全」按钮
  card.querySelectorAll('.btn-update-match').forEach(btn => {
    btn.addEventListener('click', () => handleUpdateMatch(parseInt(btn.dataset.id)));
  });
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
      size_mb: parseFloat(els.vSizeMb.value) || 0,
      category: currentVideo.category,
      source_site: currentVideo.source_site,
      preview_url: currentVideo.preview_url || '',
      download_path: (els.vDownloadPath.value || '').trim(),
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

async function handleUpdateMatch(matchId) {
  if (!currentVideo) return;
  const match = (lastCheckResult.matches || []).find(m => m.id === matchId);
  if (!match) return;

  setStatus(`正在补全 #${matchId}...`);
  // 禁用所有补全按钮
  document.querySelectorAll('.btn-update-match').forEach(b => b.disabled = true);

  try {
    const patch = {};
    if (currentVideo.url && !match.url) patch.url = currentVideo.url;
    if (currentVideo.preview_url) patch.preview_url = currentVideo.preview_url;
    if (currentVideo.duration_secs && (!match.duration_secs || match.duration_secs === 0)) {
      patch.duration_secs = currentVideo.duration_secs;
    }
    if (currentVideo.duration_str && !match.duration_str) {
      patch.duration_str = currentVideo.duration_str;
    }

    if (Object.keys(patch).length === 0) {
      setStatus(`#${matchId} 数据已完整，无需补全`);
      return;
    }

    const result = await chrome.runtime.sendMessage({
      action: 'updateVideo',
      video_id: matchId,
      patch,
    });

    if (result.error) throw new Error(result.error);
    setStatus(`✅ 已补全 #${matchId} (${Object.keys(patch).join(', ')})`);
    // 隐藏已补全的按钮
    const btn = document.querySelector(`.btn-update-match[data-id="${matchId}"]`);
    if (btn) btn.remove();
    await loadStats();
  } catch (e) {
    setStatus(`补全失败: ${e.message}`);
  } finally {
    document.querySelectorAll('.btn-update-match').forEach(b => b.disabled = false);
  }
}

async function handleScanDir() {
  const dir = (els.vImportDir.value || '').trim();
  if (!dir) { els.importStatus.textContent = '请输入目录路径'; return; }
  els.importStatus.textContent = '正在扫描...';
  els.btnScanDir.disabled = true;

  try {
    const scanResp = await fetch(`http://127.0.0.1:18080/api/v1/utils/scan-dir?path=${encodeURIComponent(dir)}`);
    const scanData = await scanResp.json();
    if (scanData.error) { els.importStatus.textContent = scanData.error; return; }
    if (scanData.count === 0) { els.importStatus.textContent = '未发现视频文件'; return; }

    els.importStatus.textContent = `发现 ${scanData.count} 个文件，正在导入...`;

    // 调批量导入
    const items = scanData.files.map(f => ({
      url: '',
      title: f.title,
      size_mb: f.size_mb,
      duration_secs: f.duration_secs || 0,
      duration_str: f.duration_str || '',
      download_path: f.path,
      source_site: 'local',
      category: '',
    }));

    const importResp = await chrome.runtime.sendMessage({
      action: 'importVideos',
      items,
    });

    if (importResp.error) throw new Error(importResp.error);
    els.importStatus.textContent = `✅ 导入 ${importResp.success_count} / ${scanData.count} (跳过 ${importResp.duplicate_count} 重复)`;
    await loadStats();
  } catch (e) {
    els.importStatus.textContent = `扫描失败: ${e.message}`;
  } finally {
    els.btnScanDir.disabled = false;
  }
}

function filenameFromPath(p) {
  return (p || '').replace(/\\/g, '/').split('/').pop();
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
