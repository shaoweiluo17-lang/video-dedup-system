/**
 * 设置页交互脚本 — 含规则引擎编辑器
 */
'use strict';

const DEFAULTS = {
  apiUrl: 'http://127.0.0.1:18080',
  apiKey: 'change-me',
  downloadFolder: 'D:/Downloads/Movies',
  downloadSuffix: '',
  autoCheck: true,
};

const BUILTIN_RULE_IDS = ['bilibili', 'youtube', 'douyin', 'generic'];

const $ = (sel) => document.querySelector(sel);

let editingRuleId = null;

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await renderRuleList();
  bindEvents();
});

// ==================== 基础设置 ====================
async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  const cfg = { ...DEFAULTS, ...stored };
  $('#apiUrl').value = cfg.apiUrl;
  $('#apiKey').value = cfg.apiKey;
  $('#downloadFolder').value = cfg.downloadFolder;
  $('#downloadSuffix').value = cfg.downloadSuffix;
  $('#autoCheck').checked = cfg.autoCheck;
}

async function saveSettings() {
  const cfg = {
    apiUrl: $('#apiUrl').value.trim(),
    apiKey: $('#apiKey').value.trim(),
    downloadFolder: $('#downloadFolder').value.trim(),
    downloadSuffix: $('#downloadSuffix').value.trim(),
    autoCheck: $('#autoCheck').checked,
  };
  await chrome.storage.sync.set(cfg);
  showSaved();
}

function showSaved() {
  const el = $('#apiStatus');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

async function resetSettings() {
  await chrome.storage.sync.set(DEFAULTS);
  await loadSettings();
  showSaved();
}

async function testApiConnection() {
  const apiUrl = $('#apiUrl').value.trim();
  const apiKey = $('#apiKey').value.trim();
  const resultEl = $('#testResult');
  resultEl.classList.remove('hidden');
  try {
    const resp = await fetch(`${apiUrl.replace(/\/+$/, '')}/health`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (resp.ok) {
      const data = await resp.json();
      resultEl.className = 'test-result ok';
      resultEl.textContent = `✅ 连接成功 — 服务状态: ${data.status || 'ok'}`;
    } else {
      resultEl.className = 'test-result fail';
      resultEl.textContent = `❌ 请求失败 — HTTP ${resp.status}`;
    }
  } catch (e) {
    resultEl.className = 'test-result fail';
    resultEl.textContent = `❌ 无法连接 — ${e.message}`;
  }
}

// ==================== 规则管理 ====================
async function getUserRules() {
  const stored = await chrome.storage.sync.get('extractorRules');
  try {
    return stored.extractorRules ? JSON.parse(stored.extractorRules) : [];
  } catch (_) {
    return [];
  }
}

async function saveUserRules(rules) {
  await chrome.storage.sync.set({ extractorRules: JSON.stringify(rules) });
}

async function renderRuleList() {
  const userRules = await getUserRules();
  const container = $('#rulesList');
  const allRules = getBuiltinWithOverrides(userRules);

  let html = '<table style="width:100%;font-size:12px;border-collapse:collapse;">';
  html += '<tr style="border-bottom:1px solid #eee;color:#888;"><th style="text-align:left;padding:4px;">状态</th><th style="text-align:left;padding:4px;">名称</th><th style="text-align:left;padding:4px;">URL 匹配</th><th style="text-align:left;padding:4px;">操作</th></tr>';

  for (const r of allRules) {
    const isBuiltin = BUILTIN_RULE_IDS.includes(r.id);
    const badge = isBuiltin ? '<span style="color:#888;font-size:10px;">[预置]</span>' : '<span style="color:#667eea;font-size:10px;">[自定义]</span>';
    html += `<tr style="border-bottom:1px solid #eee;">
      <td style="padding:4px;">${r.enabled ? '🟢' : '⚪'}</td>
      <td style="padding:4px;">${escapeHtml(r.name)} ${badge}</td>
      <td style="padding:4px;font-family:monospace;font-size:10px;">${escapeHtml(r.urlPattern || '')}</td>
      <td style="padding:4px;"><button class="btn-ghost-sm" data-edit="${r.id}">✏️</button></td>
    </tr>`;
  }
  html += '</table>';
  container.innerHTML = html;

  // 绑定编辑按钮
  container.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => openRuleEditor(btn.dataset.edit));
  });
}

function getBuiltinWithOverrides(userRules) {
  // 从 content.js 的 BUILTIN_RULES 复制一份简化版用于 UI 展示
  const builtins = [
    { id: 'bilibili', name: 'B站 (bilibili)', urlPattern: 'bilibili.com/video/', enabled: true },
    { id: 'youtube', name: 'YouTube', urlPattern: 'youtube.com/watch', enabled: true },
    { id: 'douyin', name: '抖音 (douyin)', urlPattern: 'douyin.com/video/', enabled: true },
    { id: 'generic', name: '通用提取（保底）', urlPattern: '.*', enabled: true },
  ];

  const result = [];
  for (const b of builtins) {
    const override = userRules.find(r => r.id === b.id);
    result.push(override ? { ...b, ...override } : b);
  }
  for (const ur of userRules) {
    if (!BUILTIN_RULE_IDS.includes(ur.id)) {
      result.push(ur);
    }
  }
  return result;
}

async function openRuleEditor(ruleId) {
  editingRuleId = ruleId;
  const allRules = getBuiltinWithOverrides(await getUserRules());
  const rule = allRules.find(r => r.id === ruleId) || { id: '', name: '', urlPattern: '', enabled: true, extractors: {} };

  $('#ruleId').value = rule.id;
  $('#ruleName').value = rule.name;
  $('#ruleUrlPattern').value = rule.urlPattern;
  $('#ruleJson').value = JSON.stringify(rule, null, 2);

  const isBuiltin = BUILTIN_RULE_IDS.includes(ruleId);
  $('#btnDeleteRule').style.display = isBuiltin ? 'none' : 'inline-block';
  $('#ruleEditor').classList.remove('hidden');
}

function closeRuleEditor() {
  $('#ruleEditor').classList.add('hidden');
  editingRuleId = null;
}

async function saveRule() {
  const id = $('#ruleId').value.trim();
  const name = $('#ruleName').value.trim();
  const urlPattern = $('#ruleUrlPattern').value.trim();
  let ruleJson;

  try {
    ruleJson = JSON.parse($('#ruleJson').value);
  } catch (e) {
    alert('JSON 格式错误: ' + e.message);
    return;
  }

  if (!id || !urlPattern) {
    alert('规则 ID 和 URL 正则不能为空');
    return;
  }

  const newRule = { id, name: name || id, urlPattern, enabled: true, ...ruleJson };

  let userRules = await getUserRules();
  const idx = userRules.findIndex(r => r.id === id);
  if (idx >= 0) {
    userRules[idx] = newRule;
  } else {
    userRules.push(newRule);
  }

  await saveUserRules(userRules);
  closeRuleEditor();
  await renderRuleList();
}

async function deleteRule() {
  if (!editingRuleId) return;
  if (!confirm('确定删除规则 "' + editingRuleId + '"？预置规则不会被真正删除，只会恢复默认。')) return;

  let userRules = await getUserRules();
  userRules = userRules.filter(r => r.id !== editingRuleId);
  await saveUserRules(userRules);
  closeRuleEditor();
  await renderRuleList();
}

async function addNewRule() {
  editingRuleId = null;
  $('#ruleId').value = '';
  $('#ruleName').value = '';
  $('#ruleUrlPattern').value = '';
  $('#ruleJson').value = JSON.stringify({
    id: '',
    name: '',
    urlPattern: '',
    enabled: true,
    extractors: {
      title: { type: 'css', selector: 'h1', postProcess: ['trim'] },
      duration_secs: { type: 'eval', code: '0' },
    },
  }, null, 2);
  $('#btnDeleteRule').style.display = 'inline-block';
  $('#ruleEditor').classList.remove('hidden');
}

async function exportRules() {
  const userRules = await getUserRules();
  const blob = new Blob([JSON.stringify(userRules, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'video-dedup-rules.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function importRules() {
  const input = $('#importFileInput');
  input.click();
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (!Array.isArray(imported)) throw new Error('格式应为规则数组');
      let userRules = await getUserRules();
      for (const ir of imported) {
        if (!ir.id || !ir.urlPattern) continue;
        const idx = userRules.findIndex(r => r.id === ir.id);
        if (idx >= 0) userRules[idx] = ir;
        else userRules.push(ir);
      }
      await saveUserRules(userRules);
      await renderRuleList();
      alert('导入成功');
    } catch (e) {
      alert('导入失败: ' + e.message);
    }
    input.value = '';
  };
}

// ============ 事件绑定 ============
function bindEvents() {
  $('#btnSave').addEventListener('click', saveSettings);
  $('#btnReset').addEventListener('click', resetSettings);
  $('#btnTestApi').addEventListener('click', testApiConnection);

  ['apiUrl', 'apiKey', 'downloadFolder', 'downloadSuffix'].forEach(id => {
    $(`#${id}`).addEventListener('change', saveSettings);
  });
  $('#autoCheck').addEventListener('change', saveSettings);

  $('#btnAddRule').addEventListener('click', addNewRule);
  $('#btnExportRules').addEventListener('click', exportRules);
  $('#btnImportRules').addEventListener('click', importRules);
  $('#btnSaveRule').addEventListener('click', saveRule);
  $('#btnCancelRule').addEventListener('click', closeRuleEditor);
  $('#btnDeleteRule').addEventListener('click', deleteRule);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
