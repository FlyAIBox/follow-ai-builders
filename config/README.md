[中文](README.zh-CN.md) | **English**

# Source Configuration

Follow Builders uses a **two-tier source model**:

| Tier | File | Role |
|------|------|------|
| **Curated (default digest)** | [`default-sources.json`](default-sources.json) | Hand-picked builders, podcasts, and official blogs for daily digest generation |
| **Extended catalog** | [`bestblogs-sources.json`](bestblogs-sources.json) | 400 RSS sources imported from [BestBlogs](https://bestblogs.dev) OPML files |

**Philosophy:** Follow **builders** who ship products and share original opinions — not **influencers** who only repackage news.

---

## Curated sources — `default-sources.json`

Used by `scripts/generate-feed.js` for the central feed pipeline (`feed-x.json`, `feed-podcasts.json`, `feed-blogs.json`).

| Category | Count | Notes |
|----------|------:|-------|
| X accounts | 26 | AI builders, researchers, product leaders (official X API) |
| Podcasts | 6 | English AI podcasts with transcript pipeline |
| Blogs | 2 | Anthropic Engineering, Claude Blog (scrape) |

Each entry may include a `focus` field — a short hint for the LLM on signal type (agents, GPU/infra, product launches, etc.).

---

## Extended catalog — BestBlogs (400 sources)

> **Attribution:** OPML subscriptions are shared publicly by **[bestblogs.dev](https://bestblogs.dev)**, curated in the [BestBlogs](https://github.com/ginobefun/BestBlogs) project. See also [Gino's notes on podcasts & videos](https://www.ginonotes.com/posts/bestblogs-sources-part2-podcasts-videos).

### OPML files (`bestblogs/opml/`)

| File | Category | Count |
|------|----------|------:|
| `BestBlogs_RSS_ALL.opml` | All | 400 |
| `BestBlogs_RSS_Articles.opml` | Articles / blogs | 170 |
| `BestBlogs_RSS_Podcasts.opml` | Podcasts | 30 |
| `BestBlogs_RSS_Videos.opml` | Videos (YouTube RSS) | 40 |
| `BestBlogs_RSS_Twitters.opml` | Twitter / X (RSS mirrors) | 160 |

### Generated JSON — `bestblogs-sources.json`

Do **not** hand-edit entries. Regenerate from OPML:

```bash
cd scripts && npm run import-bestblogs
# or: node import-bestblogs-opml.js
```

Output structure:

```json
{
  "stats": { "articles": 170, "podcasts": 30, "videos": 40, "x_accounts": 160, "total": 400 },
  "blogs": [ { "name": "...", "type": "rss", "rssUrl": "...", "source": "bestblogs", "attribution": "bestblogs.dev" } ],
  "podcasts": [ ... ],
  "videos": [ ... ],
  "x_accounts": [ { "name": "...", "handle": "...", "fetchMethod": "rss", "rssUrl": "...", "source": "bestblogs" } ]
}
```

The extended catalog is a **reference pool** for discovery and feed expansion. It runs **in parallel** with the curated layer in `default-sources.json` — daily digests include **both** when content is available.

| Layer | Feed files | Content |
|-------|------------|---------|
| **Curated (original)** | `feed-x.json`, `feed-podcasts.json`, `feed-blogs.json` | 26 X + 6 podcasts + 2 blogs via X API / pod2txt / scrape |
| **BestBlogs extended** | `feed-bestblogs.json` | 400 RSS sources via `generate-bestblogs-feed.js` |

---

## User config — `config-schema.json`

Describes fields in `~/.follow-builders/config.json` (language, timezone, delivery, etc.). Not related to RSS source lists.

---

## Updating sources

| Goal | Action |
|------|--------|
| Refresh BestBlogs OPML | Replace files under `bestblogs/opml/`, run `npm run import-bestblogs` |
| Change default digest sources | Edit `default-sources.json` (maintainer) |
| Suggest a new builder | Open a [GitHub Issue](https://github.com/FlyAIBox/follow-builders/issues) |

When adding curated sources, prefer first-hand builders, official teams, and agent/GPU/infra practitioners — avoid repost-only or low-signal accounts.
