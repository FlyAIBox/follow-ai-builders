[English](README.md) | **中文**

# 信息源配置说明

Follow Builders 采用 **双层信息源** 结构：

| 层级 | 文件 | 用途 |
|------|------|------|
| **精选层（默认 digest）** | [`default-sources.json`](default-sources.json) | 手工筛选的建造者、播客与官方博客，用于日常摘要生成 |
| **扩展目录** | [`bestblogs-sources.json`](bestblogs-sources.json) | 从 [BestBlogs](https://bestblogs.dev) OPML 导入的 400 个 RSS 信息源 |

**理念：** 追踪那些真正在做产品、有独立见解的 **建造者（Builders）**，而非只会搬运信息的 **网红（Influencers）**。

---

## 精选信息源 — `default-sources.json`

由 `scripts/generate-feed.js` 读取，用于中心化 feed 管道（`feed-x.json`、`feed-podcasts.json`、`feed-blogs.json`）。

| 类别 | 数量 | 说明 |
|------|-----:|------|
| X 账号 | 26 | AI 建造者、研究员、产品负责人（官方 X API 抓取） |
| 播客 | 6 | 英文 AI 播客，走转录管道 |
| 博客 | 2 | Anthropic Engineering、Claude Blog（网页抓取） |

每条来源可含 `focus` 字段，向 LLM 提示信号类型（Agent、GPU/基础设施、产品发布等）。

---

## 扩展目录 — BestBlogs（400 个）

> **来源注明：** 以下 OPML 订阅列表来自 **[bestblogs.dev](https://bestblogs.dev)** 的公开分享，整理自 [BestBlogs](https://github.com/ginobefun/BestBlogs) 项目。延伸阅读：[Gino 的播客与视频源说明](https://www.ginonotes.com/posts/bestblogs-sources-part2-podcasts-videos)。

### OPML 文件（`bestblogs/opml/`）

| 文件 | 类别 | 数量 |
|------|------|-----:|
| `BestBlogs_RSS_ALL.opml` | 全部 | 400 |
| `BestBlogs_RSS_Articles.opml` | 文章 / 博客 | 170 |
| `BestBlogs_RSS_Podcasts.opml` | 播客 | 30 |
| `BestBlogs_RSS_Videos.opml` | 视频（YouTube RSS） | 40 |
| `BestBlogs_RSS_Twitters.opml` | Twitter / X（RSS 镜像） | 160 |

### 生成的 JSON — `bestblogs-sources.json`

**请勿手改条目。** 更新 OPML 后重新生成：

```bash
cd scripts && npm run import-bestblogs
# 或：node import-bestblogs-opml.js
```

输出结构示例：

```json
{
  "stats": { "articles": 170, "podcasts": 30, "videos": 40, "x_accounts": 160, "total": 400 },
  "blogs": [ { "name": "...", "type": "rss", "rssUrl": "...", "source": "bestblogs", "attribution": "bestblogs.dev" } ],
  "podcasts": [ ... ],
  "videos": [ ... ],
  "x_accounts": [ { "name": "...", "handle": "...", "fetchMethod": "rss", "rssUrl": "...", "source": "bestblogs" } ]
}
```

扩展目录是 **参考池**，与 `default-sources.json` 精选层 **并行运行** — daily digest 在两边都有内容时会 **同时包含**。

| 层级 | Feed 文件 | 内容 |
|------|-----------|------|
| **精选层（原有）** | `feed-x.json`、`feed-podcasts.json`、`feed-blogs.json` | 26 X + 6 播客 + 2 博客（X API / pod2txt / 抓取） |
| **BestBlogs 扩展层** | `feed-bestblogs.json` | 400 RSS 源（`generate-bestblogs-feed.js` 生成） |

---

## 用户配置 — `config-schema.json`

描述 `~/.follow-builders/config.json` 的字段（语言、时区、投递方式等），与 RSS 信息源列表无关。

---

## 如何更新信息源

| 目标 | 操作 |
|------|------|
| 刷新 BestBlogs OPML | 替换 `bestblogs/opml/` 下文件，运行 `npm run import-bestblogs` |
| 修改默认 digest 源 | 编辑 `default-sources.json`（维护者） |
| 建议新增建造者 | 提交 [GitHub Issue](https://github.com/FlyAIBox/follow-builders/issues) |

新增精选源时，优先一手建设者、官方团队、Agent/GPU/基础设施实践者 — 避免纯搬运、低原创账号。
