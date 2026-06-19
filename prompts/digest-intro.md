# Digest Intro Prompt

You are assembling the final AI Builders Digest. Your job is to merge and organize
ALL content from **both layers** (curated builders + BestBlogs extended) into a single,
coherent digest organized by **content dimension** — not by source.

## Two Content Layers (both required when present)

1. **Curated layer** — root `x`, `blogs`, `podcasts` (26 X builders, official blogs, podcasts with transcripts)
2. **BestBlogs extended** — `bestblogs.articles`, `bestblogs.podcasts`, `bestblogs.videos`, `bestblogs.x`
   (RSS subscriptions from bestblogs.dev, no full transcripts)

Never drop one layer because the other exists. Merge items from both into the same sections below.

## Output Format

Start with this header:

```
AI Builders Digest — [Date]
[N] builders · [M] articles · [P] podcasts · [Q] videos
Curated: Follow Builders | Extended: bestblogs.dev
```

Then organize ALL content into the following sections (only include sections with content):

---

### 一、大模型动态 | Model Updates
New model releases, capability announcements, benchmarks, evals.
Sources: official X accounts, company blogs, BestBlogs articles about model releases.

### 二、Agent 工具链 | Agent Tooling
Agent frameworks, coding agents, workflow automation, MCP, skills, subagents.
Sources: builder tweets about coding agents, Claude Code, Codex, Replit, etc.

### 三、产品发布 | Product Launches
Specific product features, platform updates, integrations.

### 四、企业 AI | Enterprise AI
Enterprise adoption, governance, cost/performance, domain context, accountability.

### 五、产业洞察 | Industry Signals
Market analysis, predictions, founder advice, infrastructure trends, GPU/infra signals.

### 六、中文科技圈 | Chinese Tech
Chinese tech news, podcasts, company updates (primarily from BestBlogs extended layer).

### 七、深度播客 | Deep Dives
Full-transcript podcast summaries (curated layer only, uses `summarize_podcast` prompt).
For BestBlogs podcasts (no transcript): title + one-sentence description only.

---

### 总结 | Summary

Close the digest with a **5–8 bullet** editorial summary:
- The 2–3 most important signals of the day
- Any notable convergence across sources
- One forward-looking observation

Format: plain bullets, no headers inside the summary.

---

## Rules

- Each item belongs in **one section only** — do not repeat across sections
- Every item MUST include its `url` from the JSON. No URL = do not include.
- Do NOT write Twitter handles with @ prefix (breaks Telegram links)
- Use author's full name + role/company for curated X items (use `bio` field)
- For BestBlogs items: source name as label, title as heading, summary from `summary` field
- Skip low-signal content: pure retweets, engagement bait, political takes, duplicate stories
- Prefer AI / Agent / GPU / infra / product signals when selecting BestBlogs items
- Do NOT fabricate content. Only use what is in the JSON.

## Language

- `en`: all English
- `zh`: all Chinese
- `bilingual`: for each item, English paragraph then Chinese paragraph directly below, then next item.
  Do NOT output all English first then all Chinese.

## Footer

Last line: "Generated through the Follow Builders skill: https://github.com/FlyAIBox/follow-builders"
