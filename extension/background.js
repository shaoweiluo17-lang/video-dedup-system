/**
 * Service Worker —— API 通信 + 后台任务
 */
'use strict';

// ---------- 配置读取 ----------
async function getConfig() {
  const defaults = {
    apiUrl: 'http://127.0.0.1:18080',
    apiKey: 'change-me',
    downloadFolder: 'D:/Downloads/Movies',
    downloadSuffix: '',
    autoCheck: true,
  };
  const stored = await chrome.storage.sync.get(defaults);
  return { ...defaults, ...stored };
}

// ---------- API 代理 ----------
async function apiCall(path, method = 'GET', body = null) {
  const cfg = await getConfig();
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': cfg.apiKey,
  };

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const url = `${cfg.apiUrl.replace(/\/+$/, '')}${path}`;
  const resp = await fetch(url, options);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API ${resp.status}: ${text}`);
  }
  return resp.json();
}

// ---------- 消息路由 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });
  return true;
});

async function handleMessage(msg, sender) {
  switch (msg.action) {

    // 检查视频是否存在
    case 'checkDuplicate': {
      const params = new URLSearchParams({
        title: msg.title || '',
        duration_secs: String(msg.duration_secs || 0),
        size_mb: String(msg.size_mb || 0),
        source_site: msg.source_site || '',
      });
      if (msg.url) params.set('url', msg.url);
      return apiCall(`/api/v1/videos/check?${params.toString()}`);
    }

    // 添加视频记录
    case 'addVideo': {
      return apiCall('/api/v1/videos', 'POST', {
        url: msg.url || '',
        title: msg.title || '',
        size_mb: msg.size_mb || 0,
        duration_secs: msg.duration_secs || 0,
        duration_str: msg.duration_str || '',
        category: msg.category || '',
        source_site: msg.source_site || '',
        download_path: msg.download_path || '',
        preview_url: msg.preview_url || '',
      });
    }

    // 获取统计
    case 'getStats': {
      return apiCall('/api/v1/videos/stats');
    }

    // 搜索
    case 'search': {
      const params = new URLSearchParams({
        query: msg.query || '',
        page: String(msg.page || 1),
        page_size: String(msg.page_size || 20),
      });
      return apiCall(`/api/v1/videos/search?${params.toString()}`);
    }

    // 触发 IDM 下载（TODO: 调用 idm_bridge）
    case 'triggerDownload': {
      const cfg = await getConfig();
      const savePath = `${cfg.downloadFolder}/${msg.fileName || 'video.mp4'}`.replace(/\\/g, '/');
      // 通过 downloads API 发起下载
      try {
        const downloadId = await chrome.downloads.download({
          url: msg.url,
          filename: savePath,
          saveAs: false,
        });
        return { success: true, downloadId, path: savePath };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }

    default:
      return { error: `unknown action: ${msg.action}` };
  }
}
