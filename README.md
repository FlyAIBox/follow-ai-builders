**English** | [中文](README.zh-CN.md)

# Follow Builders, Not Influencers

An AI-powered digest that tracks the top builders in AI — researchers, founders, PMs,
and engineers who are actually building things — and delivers curated summaries of
what they're saying.

**Philosophy:** Follow **builders** who ship products and share original opinions — not **influencers** who only repackage news.

## What You Get

A daily or weekly digest delivered to your preferred messaging app (Telegram, Discord,
WhatsApp, etc.) with:

- Summaries of new podcast episodes from top AI podcasts
- Key posts and insights from 26 curated AI builders on X/Twitter
- Full articles from official AI company blogs (Anthropic Engineering, Claude Blog)
- An extended catalog of **400 BestBlogs RSS sources** (articles, podcasts, videos, X) for discovery and future expansion
- Links to all original content
- Available in English, Chinese, or bilingual

## Quick Start

1. Install the skill in your agent (OpenClaw or Claude Code)
2. Say "set up follow builders" or invoke `/follow-builders`
3. The agent walks you through setup conversationally — no config files to edit

The agent will ask you:
- How often you want your digest (daily or weekly) and what time
- What language you prefer
- How you want it delivered (Telegram, email, or in-chat)

No API keys needed — all content is fetched centrally.
Your first digest arrives immediately after setup.

## Changing Settings

Your delivery preferences are configurable through conversation. Just tell your agent:

- "Switch to weekly digests on Monday mornings"
- "Change language to Chinese"
- "Make the summaries shorter"
- "Show me my current settings"

The source list (builders and podcasts) is curated centrally and updates
automatically — you always get the latest sources without doing anything.

## Customizing the Summaries

The skill uses plain-English prompt files to control how content is summarized.
You can customize them two ways:

**Through conversation (recommended):**
Tell your agent what you want — "Make summaries more concise," "Focus on actionable
insights," "Use a more casual tone." The agent updates the prompts for you.

**Direct editing (power users):**
Edit the files in the `prompts/` folder:
- `summarize-podcast.md` — how podcast episodes are summarized
- `summarize-tweets.md` — how X/Twitter posts are summarized
- `summarize-blogs.md` — how blog posts are summarized
- `digest-intro.md` — the overall digest format and tone
- `translate.md` — how English content is translated to Chinese

These are plain English instructions, not code. Changes take effect on the next digest.

## Default Sources

### Podcasts (6)
- [Latent Space](https://www.youtube.com/@LatentSpacePod)
- [Training Data](https://www.youtube.com/playlist?list=PLOhHNjZItNnMm5tdW61JpnyxeYH5NDDx8)
- [No Priors](https://www.youtube.com/@NoPriorsPodcast)
- [Unsupervised Learning](https://www.youtube.com/@RedpointAI)
- [The MAD Podcast with Matt Turck](https://www.youtube.com/@DataDrivenNYC)
- [AI & I by Every](https://www.youtube.com/playlist?list=PLuMcoKK9mKgHtW_o9h5sGO2vXrffKHwJL)

### AI Builders on X (26)
[Andrej Karpathy](https://x.com/karpathy), [Swyx](https://x.com/swyx), [Josh Woodward](https://x.com/joshwoodward), [Boris Cherny](https://x.com/bcherny), [Thibault Sottiaux](https://x.com/thsottiaux), [Peter Yang](https://x.com/petergyang), [Nan Yu](https://x.com/thenanyu), [Madhu Guru](https://x.com/realmadhuguru), [Amanda Askell](https://x.com/AmandaAskell), [Cat Wu](https://x.com/_catwu), [Thariq](https://x.com/trq212), [Google Labs](https://x.com/GoogleLabs), [Amjad Masad](https://x.com/amasad), [Guillermo Rauch](https://x.com/rauchg), [Alex Albert](https://x.com/alexalbert__), [Aaron Levie](https://x.com/levie), [Ryo Lu](https://x.com/ryolu_), [Garry Tan](https://x.com/garrytan), [Matt Turck](https://x.com/mattturck), [Zara Zhang](https://x.com/zarazhangrui), [Nikunj Kothari](https://x.com/nikunj), [Peter Steinberger](https://x.com/steipete), [Dan Shipper](https://x.com/danshipper), [Aditya Agarwal](https://x.com/adityaag), [Sam Altman](https://x.com/sama), [Claude](https://x.com/claudeai)

### Official Blogs (2)
- [Anthropic Engineering](https://www.anthropic.com/engineering) — technical deep-dives from the Anthropic team
- [Claude Blog](https://claude.com/blog) — product announcements and updates from Claude

> The default daily digest uses these **34 curated sources** (26 X + 6 podcasts + 2 blogs). See [`config/default-sources.json`](config/default-sources.json).

## Extended Sources — BestBlogs (400)

In addition to the curated tier, this repo includes **400 RSS subscriptions** shared publicly by **[bestblogs.dev](https://bestblogs.dev)**, curated in the [BestBlogs](https://github.com/ginobefun/BestBlogs) project. Reference: [Gino's notes on podcasts & videos](https://www.ginonotes.com/posts/bestblogs-sources-part2-podcasts-videos).

**Same philosophy:** Follow **builders** who ship products and share original opinions — not **influencers** who only repackage news.

### OPML files (`config/bestblogs/opml/`)

| File | Category | Count |
|------|----------|------:|
| `BestBlogs_RSS_ALL.opml` | All | 400 |
| `BestBlogs_RSS_Articles.opml` | Articles / blogs | 170 |
| `BestBlogs_RSS_Podcasts.opml` | Podcasts | 30 |
| `BestBlogs_RSS_Videos.opml` | Videos | 40 |
| `BestBlogs_RSS_Twitters.opml` | Twitter / X | 160 |

### Generated JSON

Run `cd scripts && npm run import-bestblogs` to regenerate [`config/bestblogs-sources.json`](config/bestblogs-sources.json) from the OPML files.

The extended catalog is a **reference pool** for browsing Chinese/English tech blogs, podcasts, video channels, and X accounts. The **default daily digest still uses the curated tier** unless maintainers merge entries into the feed pipeline.

See [`config/README.md`](config/README.md) for full source configuration docs.

## Installation

### OpenClaw
```bash
# From ClawhHub (coming soon)
clawhub install follow-builders

# Or manually
git clone https://github.com/FlyAIBox/follow-builders.git ~/skills/follow-builders
cd ~/skills/follow-builders/scripts && npm install
```

### Claude Code
```bash
git clone https://github.com/FlyAIBox/follow-builders.git ~/.claude/skills/follow-builders
cd ~/.claude/skills/follow-builders/scripts && npm install
```

## Requirements

- An AI agent (OpenClaw, Claude Code, or similar)
- Internet connection (to fetch the central feed)

That's it. No API keys needed. All content (blog articles + YouTube transcripts + X/Twitter posts)
is fetched centrally and updated daily.

## How It Works

1. A central feed is updated daily with the latest content from all sources
   (blog articles via web scraping, podcast transcripts via pod2txt, X/Twitter via official API)
2. Your agent fetches the feed — one HTTP request, no API keys
3. Your agent remixes the raw content into a digestible summary using your preferences
4. The digest is delivered to your messaging app (or shown in-chat)

See [examples/sample-digest.md](examples/sample-digest.md) for what the output looks like.

## Architecture

Follow Builders is split into a central feed pipeline and a local skill runtime:

1. **Source registry** — `config/default-sources.json` defines the curated list (26 X, 6 podcasts, 2 blogs). `config/bestblogs-sources.json` holds 400 BestBlogs RSS sources (from [bestblogs.dev](https://bestblogs.dev)).
2. **Central feed generation** — `scripts/generate-feed.js` runs in the maintainer
   environment or GitHub Actions. It fetches X posts, podcast RSS/transcripts, and
   official blog articles, deduplicates them with `state-feed.json`, then writes
   `feed-x.json`, `feed-podcasts.json`, and `feed-blogs.json`.
3. **User-side input packaging** — `scripts/prepare-digest.js` fetches the published
   feed JSON files and prompt files, merges them with the user's local preferences
   from `~/.follow-builders/config.json`, and prints one JSON payload for the LLM.
4. **LLM remix layer** — the agent reads the payload and follows the prompt files in
   `prompts/` to rank, group, summarize, translate, and connect the raw items into
   a digest focused on high-signal AI, agents, infrastructure, and GPU-related news.
5. **Delivery layer** — `scripts/deliver.js` sends the final digest to stdout,
   Telegram, or email. OpenClaw can also deliver through its own channel system.

The data boundary is intentional: scripts fetch and normalize content
deterministically, while the LLM is only responsible for editorial judgment and
writing. This keeps API keys, scheduling, deduplication, and delivery out of the
prompting layer.

## Codex Usage

This repository is a Codex-compatible skill. To use it in Codex, install or copy the
folder into your Codex skills directory, then ask Codex to use the skill:

```bash
mkdir -p ~/.codex/skills
git clone https://github.com/FlyAIBox/follow-builders.git ~/.codex/skills/follow-builders
cd ~/.codex/skills/follow-builders/scripts && npm install
```

Example Codex prompts:

- `/ai`
- `Use follow-builders to prepare today's AI builders digest`
- `Summarize the latest agent and GPU infrastructure signals from follow-builders`
- `Update follow-builders to focus more on agents, GPUs, inference infra, and product launches`

For on-demand use, Codex runs `scripts/prepare-digest.js`, reads the returned JSON,
applies the prompt files, and prints the digest in the chat. For scheduled delivery,
configure `~/.follow-builders/config.json` and use OpenClaw cron, system cron, or an
external scheduler to run the same prepare -> summarize -> deliver flow.

When customizing for higher-quality AI/Agent/GPU aggregation, edit sources and
prompts separately:

- Curated tier: edit `config/default-sources.json` (maintainer)
- BestBlogs extended catalog: update OPML under `config/bestblogs/opml/`, run `npm run import-bestblogs`
- Adjust ranking and summarization criteria in `prompts/summarize-*.md`
- Keep generated feed files as outputs; do not hand-edit them unless debugging

## Privacy

- No API keys are sent anywhere — all content is fetched centrally
- If you use Telegram/email delivery, those keys are stored locally in `~/.follow-builders/.env`
- The skill only reads public content (public blog posts, public YouTube videos, public X posts)
- Your configuration, preferences, and reading history stay on your machine

## License

MIT
