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
        postProcess: ['trim', 'removeSiteSuffix'],
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
        postProcess: ['trim'],
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
        postProcess: ['trim'],
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
        postProcess: ['trim'],
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
        postProcess: ['trim'],
      },
      duration_secs: {
        type: 'css',
        selector: 'meta[property="video:duration"]',
        attr: 'content',
        postProcess: ['parseInt'],
      },
      duration_str: {
        type: 'eval',
        code: '(()=>{const d=parseInt(document.querySelector("meta[property=\\"video:duration\\"]")?.content||0);const m=Math.floor(d/60);return m+":"+String(d%60).padStart(2,"0")})()',
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
        postProcess: ['trim', 'removeSiteSuffix'],
      },
      duration_secs: {
        type: 'eval',
        code: '(()=>{const v=document.querySelector("video");if(v&&v.duration>0)return Math.round(v.duration);const t=document.querySelector(".fp-duration");if(t){const p=t.textContent.trim().split(":");if(p.length===2)return parseInt(p[0])*60+parseInt(p[1]);if(p.length===3)return parseInt(p[0])*3600+parseInt(p[1])*60+parseInt(p[2]);}return 0})()',
      },
      duration_str: {
        type: 'css',
        selector: '.fp-duration, .fp-time-duration',
        fallback: '',
        attr: null,
        postProcess: ['trim'],
      },
      category: {
        type: 'css',
        selector: 'meta[property="article:section"], meta[name="category"], .description a[href*="/categories/"]',
        attr: null,
        postProcess: ['trim'],
      },
      preview_url: {
        type: 'eval',
        code: "(()=>{const el=document.querySelector('.video-holder img[src*=\"preview\"], .fp-poster img');if(el){let v=el.getAttribute('src')||'';return v.startsWith('//')?'https:'+v:v;}const meta=document.querySelector('meta[property=\"og:image\"]');if(meta){let v=meta.getAttribute('content')||'';return v.startsWith('//')?'https:'+v:v;}return ''})()",
      },
    },
  },
];

// ============================================================
// 后处理函数
// ============================================================
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
      .replace(/\s*[-–—|｜_]\s*(B站|bilibili|YouTube|youtube|抖音|douyin|观看|在线).*$/i, '')
      .replace(/\s*[-–—|｜_].*$/, '')
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
        // 用户规则覆盖同 id 的预置规则，追加新规则
        for (const ur of userRules) {
          const idx = this.rules.findIndex(r => r.id === ur.id);
          if (idx >= 0) {
            this.rules[idx] = { ...this.rules[idx], ...ur };
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

    // type: eval
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

        if (value !== null && value !== undefined) {
          info[field] = value;
        }
      } catch (e) {
        console.warn(`applyRule field ${field} error:`, e);
      }
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
