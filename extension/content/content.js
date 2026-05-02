/**
 * 视频信息提取规则引擎 — 预置规则 + 用户自定义
 *
 * 规则格式见下方 RULES 数组。
 * 用户可在插件选项中新增/修改规则，存储在 chrome.storage.sync。
 */

'use strict';

// ============================================================
// 预置规则（每个字段可选 type: css | regex | constant | eval）
// ============================================================
const BUILTIN_RULES = [
  {
    id: 'bilibili',
    name: 'B站 (bilibili)',
    urlPattern: 'bilibili.com/video/',
    enabled: true,
    extractors: {
      title: {
        type: 'css',
        selector: 'h1.video-title',
        fallback: 'meta[property="og:title"]',
        attr: null,
        regex: '',
        regexGroup: 0,
        postProcess: ['trim', 'normalizeWhitespace', 'removeSiteSuffix'],
      },
      duration_secs: {
        type: 'css',
        selector: 'meta[itemprop="duration"]',
        attr: 'content',
        postProcess: ['iso8601ToSeconds'],
      },
      duration_str: {
        type: 'css',
        selector: 'meta[itemprop="duration"]',
        attr: 'content',
        postProcess: ['iso8601ToString'],
      },
      category: {
        type: 'css',
        selector: 'a.tag-link, .tag-area .tag',
        fallback: 'meta[name="keywords"]',
        attr: null,
        regex: '',
        postProcess: ['trim', 'normalizeWhitespace'],
      },
    },
  },
  {
    id: 'youtube',
    name: 'YouTube',
    urlPattern: 'youtube.com/watch',
    enabled: true,
    extractors: {
      title: {
        type: 'css',
        selector: 'h1.ytd-video-primary-info-renderer yt-formatted-string, h1.style-scope.ytd-watch-metadata yt-formatted-string',
        fallback: 'meta[name="title"]',
        attr: null,
        postProcess: ['trim', 'normalizeWhitespace'],
      },
      duration_secs: {
        type: 'css',
        selector: 'meta[itemprop="duration"]',
        attr: 'content',
        postProcess: ['iso8601ToSeconds'],
      },
      duration_str: {
        type: 'css',
        selector: 'span.ytp-time-duration',
        attr: null,
        regex: '(\\d+):(\\d+):?(\\d+)?',
        regexGroup: 0,
        postProcess: ['timeStrToDurationStr'],
      },
      category: {
        type: 'css',
        selector: 'meta[itemprop="genre"]',
        attr: 'content',
        postProcess: ['trim', 'normalizeWhitespace'],
      },
    },
  },
  {
    id: 'douyin',
    name: '抖音 (douyin)',
    urlPattern: 'douyin.com/video/',
    enabled: true,
    extractors: {
      title: {
        type: 'css',
        selector: 'meta[property="og:title"]',
        fallback: 'title',
        attr: 'content',
        postProcess: ['trim', 'normalizeWhitespace'],
      },
      duration_secs: {
        type: 'css',
        selector: 'meta[property="video:duration"]',
        attr: 'content',
        postProcess: ['parseInt'],
      },
      duration_str: {
        type: 'function',
        name: 'douyinDurationStr',
      },
    },
  },
  {
    id: 'generic',
    name: '通用提取（保底）',
    urlPattern: '.*',
    enabled: true,
    extractors: {
      title: {
        type: 'css',
        selector: 'h1, .headline h1, meta[property="og:title"]',
        fallback: 'title',
        attr: null,
        postProcess: ['trim', 'normalizeWhitespace', 'removeSiteSuffix'],
      },
      duration_secs: {
        type: 'function',
        name: 'genericDurationSecs',
      },
      duration_str: {
        type: 'css',
        selector: '.fp-duration, .fp-time-duration',
        fallback: '',
        attr: null,
        postProcess: ['trim', 'normalizeWhitespace'],
      },
      category: {
        type: 'css',
        selector: 'meta[property="article:section"], meta[name="category"], .description a[href*="/categories/"]',
        attr: null,
        postProcess: ['trim', 'normalizeWhitespace'],
      },
      preview_url: {
        type: 'function',
        name: 'genericPreviewUrl',
      },
    },
  },
];

// ============================================================
// CSP-safe 提取函数（替代 eval，绕过页面的 unsafe-eval 限制）
// ============================================================
const EXTRACT_FUNCTIONS = {

  /** 抖音 duration_str */
  douyinDurationStr() {
    const d = parseInt(document.querySelector('meta[property="video:duration"]')?.content || 0);
    const m = Math.floor(d / 60);
    return m + ':' + String(d % 60).padStart(2, '0');
  },

  /** 通用 duration_secs — fp-duration 优先 */
  genericDurationSecs() {
    const t = document.querySelector('.fp-duration');
    if (t) {
      const p = t.textContent.trim().split(':');
      if (p.length === 2) return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
      if (p.length === 3) return parseInt(p[0], 10) * 3600 + parseInt(p[1], 10) * 60 + parseInt(p[2], 10);
    }
    const v = document.querySelector('video');
    if (v && v.duration > 0) return Math.round(v.duration);
    return 0;
  },

  /** 通用 preview_url — og:image 优先 */
  genericPreviewUrl() {
    function g(sel, attr) {
      try {
        const e = document.querySelector(sel);
        if (e) {
          const v = e.getAttribute(attr) || '';
          if (v) return v.indexOf('//') === 0 ? 'https:' + v : v;
        }
      } catch (_) { /* ignore */ }
      return '';
    }
    return g('meta[property="og:image"]', 'content')
        || g('.video-holder img[src*="preview"]', 'src')
        || g('.fp-poster img', 'src');
  },
};
const POST_PROCESSORS = {

  trim(v) { return (v || '').trim(); },

  parseInt(v) { return parseInt(v, 10) || 0; },

  parseFloat(v) { return parseFloat(v) || 0; },

  extractNumber(v) {
    const m = String(v || '').match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  },

  iso8601ToSeconds(v) {
    const m = String(v || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
    if (!m) return 0;
    return Math.round((parseInt(m[1]||0,10)*3600)+(parseInt(m[2]||0,10)*60)+parseFloat(m[3]||0));
  },

  iso8601ToString(v) {
    const s = this.iso8601ToSeconds(v);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return mm + ':' + String(ss).padStart(2, '0');
  },

  timeStrToDurationStr(v) {
    const m = String(v || '').match(/(\d+):(\d+):?(\d+)?/);
    if (!m) return String(v || '');
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ss = parseInt(m[3] || '0', 10);
    if (m[3]) return hh + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    return hh + ':' + String(mm).padStart(2, '0');
  },

  removeSiteSuffix(v) {
    return String(v || '')
      .replace(/\s*[-–—|｜_]\s*(B站|bilibili|YouTube|youtube|抖音|douyin|观看|在线|Watch|HD|4K|1080p|720p)\s*$/i, '')
      .replace(/\s*[-–—|｜_]\s*[a-z0-9.-]+\.[a-z]{2,}\s*$/i, '')  // 只删末尾英文域名
      .trim();
  },

  /** 归一化空白字符：&nbsp;→空格，合并连续空格 */
  normalizeWhitespace(v) {
    return String(v || '')
      .replace(/\u00A0/g, ' ')   // &nbsp; → 空格
      .replace(/\s+/g, ' ')      // 合并连续空白
      .trim();
  },

  ensureHttps(v) {
    v = String(v || '').trim();
    if (v.startsWith('//')) return 'https:' + v;
    return v;
  },
};

// ============================================================
// 规则引擎
// ============================================================
class RuleEngine {
  constructor() {
    this.rules = [...BUILTIN_RULES];
  }

  /** 合并用户自定义规则 */
  async loadFromStorage() {
    try {
      const stored = await chrome.storage.sync.get('extractorRules');
      if (stored.extractorRules) {
        const userRules = JSON.parse(stored.extractorRules);
        for (const ur of userRules) {
          const idx = this.rules.findIndex(r => r.id === ur.id);
          if (idx >= 0) {
            // 深度合并：extractors 按字段合并，其他属性浅覆盖
            const base = this.rules[idx];
            this.rules[idx] = {
              ...base,
              ...ur,
              extractors: { ...(base.extractors || {}), ...(ur.extractors || {}) },
            };
          } else {
            this.rules.push(ur);
          }
        }
      }
    } catch (e) {
      console.warn('RuleEngine: failed to load user rules', e);
    }
  }

  /** 按 URL 匹配第一个启用的规则 */
  matchRule(url) {
    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      try {
        if (new RegExp(rule.urlPattern, 'i').test(url)) {
          return rule;
        }
      } catch (_) { /* ignore bad regex */ }
    }
    return null;
  }

  /** 执行单字段提取 */
  extractField(extractor) {
    if (!extractor) return null;

    // type: function (CSP-safe 替代 eval)
    if (extractor.type === 'function') {
      const fn = EXTRACT_FUNCTIONS[extractor.name];
      if (fn) {
        try { return fn(); } catch (e) { console.warn('extractField function error:', e); return null; }
      }
      return null;
    }

    // type: eval (保留兼容，但会被 CSP 拦截)
    if (extractor.type === 'eval') {
      try {
        // eslint-disable-next-line no-eval
        return eval(extractor.code);
      } catch (e) {
        console.warn('extractField eval error:', e);
        return null;
      }
    }

    // type: constant
    if (extractor.type === 'constant') {
      return extractor.value;
    }

    // type: regex on page text
    if (extractor.type === 'regex') {
      const source = extractor.selector
        ? (document.querySelector(extractor.selector)?.textContent || '')
        : document.body?.innerText || '';
      const m = String(source).match(new RegExp(extractor.regex, extractor.regexFlags || 'i'));
      return m ? (m[extractor.regexGroup || 0] || '') : '';
    }

    // type: css (default)
    let el = null;
    if (extractor.selector) {
      // 支持逗号分隔的多个选择器（取第一个命中）
      const selectors = extractor.selector.split(/,(?![^[]*\])/);
      for (const sel of selectors) {
        el = document.querySelector(sel.trim());
        if (el) break;
      }
      // fallback
      if (!el && extractor.fallback) {
        const fbs = extractor.fallback.split(/,(?![^[]*\])/);
        for (const fb of fbs) {
          el = document.querySelector(fb.trim());
          if (el) break;
        }
      }
    }
    if (!el) return null;

    let value;
    if (extractor.attr) {
      value = el.getAttribute(extractor.attr) || '';
    } else {
      value = (el.textContent || el.innerText || '').trim();
    }

    return value;
  }

  /** 执行一个规则的所有字段提取 */
  applyRule(rule) {
    const info = {
      url: window.location.href,
      title: '',
      duration_secs: 0,
      duration_str: '',
      size_mb: 0,
      source_site: window.location.hostname,
      category: '',
      preview_url: '',
    };

    if (!rule || !rule.extractors) return info;

    for (const [field, extractor] of Object.entries(rule.extractors)) {
      try {
        let value = this.extractField(extractor);

        // 后处理
        if (extractor.postProcess && Array.isArray(extractor.postProcess)) {
          for (const proc of extractor.postProcess) {
            if (POST_PROCESSORS[proc]) {
              value = POST_PROCESSORS[proc](value);
            } else if (proc.startsWith('removeSuffix(')) {
              const arg = proc.match(/removeSuffix\((.*)\)/)?.[1]?.replace(/['"]/g, '') || '';
              value = String(value || '').replace(new RegExp('\\s*' + escapeRegex(arg) + '.*$', 'i'), '').trim();
            }
          }
        }

        if (value !== null && value !== undefined && !Number.isNaN(value)) {
          info[field] = value;
        }
      } catch (e) {
        console.warn(`applyRule field ${field} error:`, e);
      }
    }

    // 兜底: duration_secs 为 0 时从 duration_str 解析
    if (!info.duration_secs && info.duration_str) {
      const p = info.duration_str.split(':');
      if (p.length === 2) info.duration_secs = parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
      else if (p.length === 3) info.duration_secs = parseInt(p[0], 10) * 3600 + parseInt(p[1], 10) * 60 + parseInt(p[2], 10);
    }

    return info;
  }
}

// ============================================================
// 导出
// ============================================================
const engine = new RuleEngine();
engine.loadFromStorage();

const _globalExtractor = {
  engine,
  async extract() {
    const url = window.location.href;
    const rule = engine.matchRule(url);
    const info = engine.applyRule(rule);
    info._ruleId = rule ? rule.id : 'none';
    info._ruleName = rule ? rule.name : '(无匹配规则)';
    return info;
  },
};

// 适配额外来源
function extractSizeMB() {
  const meta = document.querySelector('meta[name="video_size"], meta[itemprop="contentSize"]');
  if (meta) {
    const v = parseFloat(meta.getAttribute('content') || '0');
    if (v > 0) return v;
  }
  return 0;
}

// ============================================================
// 消息处理
// ============================================================
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'extractVideoInfo') {
    _globalExtractor.extract().then(info => {
      if (!info.size_mb || info.size_mb === 0) {
        info.size_mb = extractSizeMB();
      }
      sendResponse(info);
    }).catch(e => sendResponse({ error: e.message }));
    return true;
  }
});

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
