# HTML 结构分析报告

> 源文件: `media/43604abd5b1342b4abace12095a82534_test.html`
> 分析时间: 2026-05-01

## 关键元素定位

### 1. 视频标题
| 选择器 | 示例值 | 优先级 |
|--------|--------|--------|
| `.headline h1` | `我的测试视频标题` | ⭐ 首选 |
| `flashvars.video_title` | `我的测试视频标题` | 备选 |

### 2. 预览图 preview.jpg
| 来源 | 选择器/路径 | 示例值 |
|------|------------|--------|
| `<img>` 标签 | `.video-holder img[src*="preview.jpg"]` | `//media.mytest.com/contents/videos_screenshots/6334000/6334593/preview.jpg` |
| FlashVars | `flashvars.preview_url` | 同上 |
| FlowPlayer poster | `.fp-poster img` | `//media.mytest.com/.../preview.mp4.jpg` |

**推荐**: 取 `.video-holder img[src*="preview.jpg"]` 的 `src` 属性，补全 `https:` 前缀后下载。

### 3. 视频时长
| 选择器 | 示例值 | 优先级 |
|--------|--------|--------|
| `.fp-duration` | `27:52` | ⭐ 首选（FlowPlayer 精确值） |
| `.fp-time-duration` | `27:52` | 备选 |
| `.tools-left li` 中 `Duration:` 同行 `.title-description` | `27:52` | 结构化数据 |
| `.fp-remaining` | `-27:51` | 可忽略（实时倒计时） |

**推荐**: `.fp-duration`，格式 `MM:SS` 或 `HH:MM:SS`

### 4. 页面完整 URL
| 来源 | 选择器 | 示例值 |
|------|--------|--------|
| Twitter 分享 | `.sharesTwitter[href]` → 正则提取 `url=` 参数 | `https://mytest.com/spduyem/` |
| Reddit 分享 | `.sharesReddit[href]` → 正则提取 `url=` 参数 | 同上 |
| Tumblr 分享 | `.sharesTumblr[href]` → 正则提取 `u=` 参数 | 同上 |

**推荐**: `.sharesTwitter[href]`，正则 `url=([^&]+)` 提取后 URL-decode

### 5. 其他有价值字段
| 字段 | 选择器 | 示例值 |
|------|--------|--------|
| video_id | `.video-id[data-video-id]` | `6334593` |
| 分类 | `.description a[href*="/categories/"]` | `Femdom` |
| 标签 | `.description a[href*="/tags/"]` | `lick ass, femdom, chinese...` |
| 评分 | `#rating_container img[src*="star-1.png"]` 计数 | `4.3` |
| 观看数 | `.tools-left .title-description` (Viewed 行) | `17595` |
| 上传者 | `.description a.author` | `xvshizhangguanren` |
| 上传时间 | `.tools-left .title-description` (Added 行) | `3 years ago` |
| 视频文件 URL | `.fp-engine[src]` | `https://mytest.com/get_file/4/.../6334593.mp4` |
| Embed 代码 | `textarea` 内含 iframe src | `https://mytest.com/embed/6334593/` |

## 文件结构概览

```
body
├── .wrapper
│   └── .main
│       └── .container
│           ├── .headline > h1                    ← 标题
│           └── .columns
│               ├── .column-centre.column-video
│               │   └── .wrap
│               │       ├── .video-holder
│               │       │   ├── img[src*="preview.jpg"]    ← 预览图
│               │       │   ├── #kt_player                  ← FlowPlayer
│               │       │   │   └── .fp-duration            ← 时长
│               │       │   └── script (flashvars)          ← 元数据 JSON
│               │       ├── .tools                          ← 评分/观看/时长
│               │       ├── .block-share
│               │       │   └── .sharesTwitter[href]       ← 页面URL
│               │       └── .box
│               │           └── .description               ← 分类/标签/作者
│               └── .column-right                           ← 广告位(忽略)
```

## 提取策略总结

| 字段 | 方式 | 正则/选择器 |
|------|------|------------|
| title | CSS | `.headline h1::text` |
| preview_url | CSS attr | `.video-holder img[src*="preview.jpg"]::attr(src)` |
| duration | CSS | `.fp-duration::text` |
| page_url | CSS + regex | `.sharesTwitter::attr(href)` → `url=([^&]+)` |
| video_id | CSS attr | `.video-id::attr(data-video-id)` |

> 注意：`//media.mytest.com` 是协议相对 URL，需补 `https:` 前缀后下载。
