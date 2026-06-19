#!/usr/bin/env node

// ============================================================================
// Follow Builders — Prepare Digest
// ============================================================================
// Gathers everything the LLM needs to produce a digest:
// - Fetches the central feeds (tweets + podcasts)
// - Fetches the latest prompts from GitHub
// - Reads the user's config (language, delivery method)
// - Outputs a single JSON blob to stdout
//
// The LLM's ONLY job is to read this JSON, remix the content, and output
// the digest text. Everything else is handled here deterministically.
//
// Usage: node prepare-digest.js
// Output: JSON to stdout
//
// 中文维护说明：
// 这个脚本是“用户侧运行时”的入口，不直接写摘要，也不调用任何模型。
// 它只负责把远端 feed、远端/本地 prompt、用户偏好合并成一个稳定 JSON。
// Codex 或其他 agent 读取该 JSON 后，再根据 prompts 字段完成筛选、总结、
// 翻译和最终排版。这样可以把网络抓取与编辑判断清晰分离。
// ============================================================================

import { readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// -- Constants ---------------------------------------------------------------

const USER_DIR = join(homedir(), '.follow-builders');
const CONFIG_PATH = join(USER_DIR, 'config.json');

// 远端 feed 是中心化生成的公开产物。用户运行摘要时只需要读这些 JSON，
// 不需要 X、YouTube、pod2txt 等抓取侧 API key。
const FEED_REPO = process.env.FOLLOW_BUILDERS_FEED_REPO || 'FlyAIBox/follow-builders';
const FEED_BRANCH = process.env.FOLLOW_BUILDERS_FEED_BRANCH || 'main';
const FEED_BASE = `https://raw.githubusercontent.com/${FEED_REPO}/${FEED_BRANCH}`;
// Upstream fallback when local fork feed is stale (curated layer only)
const CURATED_FALLBACK_REPO = 'zarazhangrui/follow-builders';

const FEED_BESTBLOGS_URL = `${FEED_BASE}/feed-bestblogs.json`;

// prompt 也优先走远端，便于中心化更新“什么算高质量 AI/Agent/GPU 信号”
// 的判断口径；用户自定义 prompt 仍然拥有最高优先级。
const PROMPTS_BASE = `https://raw.githubusercontent.com/${FEED_REPO}/${FEED_BRANCH}/prompts`;
const PROMPT_FILES = [
  'summarize-podcast.md',
  'summarize-tweets.md',
  'summarize-blogs.md',
  'summarize-bestblogs.md',
  'digest-intro.md',
  'translate.md'
];

// -- Fetch helpers -----------------------------------------------------------

async function fetchJSON(url) {
  // feed 获取失败不直接抛错，而是返回 null；主流程会把它记录为
  // non-fatal error。这样某一路 feed 临时不可用时，其他内容仍可摘要。
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function loadLocalFeed(filename) {
  const localPath = join(
    decodeURIComponent(new URL('.', import.meta.url).pathname),
    '..',
    filename
  );
  if (!existsSync(localPath)) return null;
  try {
    return JSON.parse(await readFile(localPath, 'utf-8'));
  } catch {
    return null;
  }
}

async function fetchFeedJSON(url, localFilename) {
  const remote = await fetchJSON(url);
  if (remote) return remote;
  return loadLocalFeed(localFilename);
}

// Curated feeds (x/podcasts/blogs): try primary repo, upstream fallback, then local.
// Picks the candidate with the newest generatedAt so stale fork feeds don't block digest.
async function fetchCuratedFeed(filename) {
  const repos = [...new Set([FEED_REPO, CURATED_FALLBACK_REPO])];
  const candidates = [];

  for (const repo of repos) {
    const url = `https://raw.githubusercontent.com/${repo}/${FEED_BRANCH}/${filename}`;
    const feed = await fetchJSON(url);
    if (feed) candidates.push({ repo, feed });
  }

  const local = await loadLocalFeed(filename);
  if (local) candidates.push({ repo: 'local', feed: local });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const ta = new Date(a.feed.generatedAt || 0).getTime();
    const tb = new Date(b.feed.generatedAt || 0).getTime();
    return tb - ta;
  });

  return candidates[0].feed;
}

async function fetchText(url) {
  // prompt 获取也采用同样的软失败策略，后续会回退到本地 prompt。
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.text();
}

async function loadLocalSourcesMetadata(scriptDir, errors) {
  // 本地 source registry 带有 focus 元数据，可帮助 LLM 理解每个来源
  // 为什么值得关注。远端 feed 尚未包含 focus 时，这里会补齐上下文。
  const sourcesPath = join(scriptDir, '..', 'config', 'default-sources.json');
  try {
    return JSON.parse(await readFile(sourcesPath, 'utf-8'));
  } catch (err) {
    errors.push(`Could not read local sources metadata: ${err.message}`);
    return {};
  }
}

function enrichWithFocus(items, lookup, keyName) {
  // 不改变 feed 原始字段，只在缺少 focus 时补充说明。
  // keyName 对 X 使用 handle，对播客/博客使用 name。
  return items.map((item) => {
    const key = String(item[keyName] || '').toLowerCase();
    const focus = lookup.get(key)?.focus;
    return focus && !item.focus ? { ...item, focus } : item;
  });
}

// -- Main --------------------------------------------------------------------

async function main() {
  const errors = [];

  // 1. Read user config
  // 用户配置只影响语言、频率和交付方式，不参与中心 feed 的抓取。
  // 如果配置损坏，继续使用默认值并把错误交给 LLM/调用方展示。
  let config = {
    language: 'en',
    frequency: 'daily',
    delivery: { method: 'stdout' }
  };
  if (existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(await readFile(CONFIG_PATH, 'utf-8'));
    } catch (err) {
      errors.push(`Could not read config: ${err.message}`);
    }
  }

  // 2. Fetch all feeds — curated layer + BestBlogs extended layer (both retained)
  const [feedX, feedPodcasts, feedBlogs, feedBestblogs] = await Promise.all([
    fetchCuratedFeed('feed-x.json'),
    fetchCuratedFeed('feed-podcasts.json'),
    fetchCuratedFeed('feed-blogs.json'),
    fetchFeedJSON(FEED_BESTBLOGS_URL, 'feed-bestblogs.json')
  ]);

  if (!feedX) errors.push('Could not fetch tweet feed');
  if (!feedPodcasts) errors.push('Could not fetch podcast feed');
  if (!feedBlogs) errors.push('Could not fetch blog feed');
  if (!feedBestblogs) errors.push('Could not fetch BestBlogs feed (run: npm run generate-bestblogs-feed)');
  if (feedX?.errors?.length) {
    errors.push(
      ...feedX.errors.map((error) => `Tweet feed problem: ${error}`)
    );
  }
  if (feedPodcasts?.errors?.length) {
    errors.push(
      ...feedPodcasts.errors.map((error) => `Podcast feed problem: ${error}`)
    );
  }
  if (feedBlogs?.errors?.length) {
    errors.push(
      ...feedBlogs.errors.map((error) => `Blog feed problem: ${error}`)
    );
  }

  // 3. Load prompts with priority: user custom > remote (GitHub) > local default
  //
  // If the user has a custom prompt at ~/.follow-builders/prompts/<file>,
  // use that (they personalized it — don't overwrite with remote updates).
  // Otherwise, fetch the latest from GitHub so they get central improvements.
  // If GitHub is unreachable, fall back to the local copy shipped with the skill.
  const prompts = {};
  const scriptDir = decodeURIComponent(new URL('.', import.meta.url).pathname);
  const localPromptsDir = join(scriptDir, '..', 'prompts');
  const userPromptsDir = join(USER_DIR, 'prompts');
  const localSources = await loadLocalSourcesMetadata(scriptDir, errors);

  for (const filename of PROMPT_FILES) {
    // prompt key 使用 snake_case，方便 LLM 在输出 JSON 中稳定引用。
    const key = filename.replace('.md', '').replace(/-/g, '_');
    const userPath = join(userPromptsDir, filename);
    const localPath = join(localPromptsDir, filename);

    // Priority 1: user's custom prompt (they personalized it)
    if (existsSync(userPath)) {
      prompts[key] = await readFile(userPath, 'utf-8');
      continue;
    }

    // Priority 2: latest from GitHub (central updates)
    const remote = await fetchText(`${PROMPTS_BASE}/${filename}`);
    if (remote) {
      prompts[key] = remote;
      continue;
    }

    // Priority 3: local copy shipped with the skill
    if (existsSync(localPath)) {
      prompts[key] = await readFile(localPath, 'utf-8');
    } else {
      errors.push(`Could not load prompt: ${filename}`);
    }
  }

  const podcastFocusByName = new Map(
    (localSources.podcasts || []).map((source) => [
      source.name.toLowerCase(),
      source
    ])
  );
  const blogFocusByName = new Map(
    (localSources.blogs || []).map((source) => [
      source.name.toLowerCase(),
      source
    ])
  );
  const xFocusByHandle = new Map(
    (localSources.x_accounts || []).map((source) => [
      source.handle.toLowerCase(),
      source
    ])
  );

  const podcasts = enrichWithFocus(feedPodcasts?.podcasts || [], podcastFocusByName, 'name');
  const x = enrichWithFocus(feedX?.x || [], xFocusByHandle, 'handle');
  const blogs = enrichWithFocus(feedBlogs?.blogs || [], blogFocusByName, 'name');

  const bestblogs = {
    articles: feedBestblogs?.articles || [],
    podcasts: feedBestblogs?.podcasts || [],
    videos: feedBestblogs?.videos || [],
    x: feedBestblogs?.x || [],
    attribution: feedBestblogs?._attribution || {
      website: 'https://bestblogs.dev',
      attribution_zh: '信息源 OPML 来自 bestblogs.dev 的公开分享'
    },
    generatedAt: feedBestblogs?.generatedAt || null
  };

  // 4. Build the output — everything the LLM needs in one blob
  // 输出结构是这个 skill 和 Codex/其他 agent 的主要接口。新增字段应保持
  // 向后兼容，避免破坏既有 prompt 或自动化流程。
  const output = {
    status: 'ok',
    generatedAt: new Date().toISOString(),

    // User preferences
    config: {
      language: config.language || 'en',
      frequency: config.frequency || 'daily',
      delivery: config.delivery || { method: 'stdout' }
    },

    // Content to remix — two layers (curated + bestblogs), both required when present
    podcasts,
    x,
    blogs,
    bestblogs,

    // Stats for the LLM to reference
    stats: {
      // Curated layer (original Follow Builders sources)
      podcastEpisodes: podcasts.length,
      xBuilders: x.length,
      totalTweets: x.reduce((sum, a) => sum + a.tweets.length, 0),
      blogPosts: blogs.length,
      curatedGeneratedAt:
        feedX?.generatedAt || feedPodcasts?.generatedAt || feedBlogs?.generatedAt || null,
      // BestBlogs extended layer (additive, from bestblogs.dev OPML)
      bestblogsArticles: bestblogs.articles.length,
      bestblogsPodcasts: bestblogs.podcasts.length,
      bestblogsVideos: bestblogs.videos.length,
      bestblogsXAccounts: bestblogs.x.length,
      bestblogsTotalItems:
        bestblogs.articles.length +
        bestblogs.podcasts.length +
        bestblogs.videos.length +
        bestblogs.x.reduce((sum, a) => sum + (a.tweets?.length || 0), 0),
      bestblogsGeneratedAt: bestblogs.generatedAt,
      // Legacy alias
      feedGeneratedAt:
        feedX?.generatedAt || feedPodcasts?.generatedAt || feedBlogs?.generatedAt || null
    },

    // Prompts — the LLM reads these and follows the instructions
    prompts,

    // Non-fatal errors
    errors: errors.length > 0 ? errors : undefined
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({
    status: 'error',
    message: err.message
  }));
  process.exit(1);
});
