#!/usr/bin/env node

// ============================================================================
// Generate feed-bestblogs.json from BestBlogs RSS sources
// ============================================================================
// 【定位】中央 feed 流水线的一部分，由 generate-feed.yml 在 all / bestblogs-only
// 模式下调用（npm run generate-bestblogs-feed）。用户侧 skill 不运行此脚本。
//
// 【职责】
//   1. 读取 config/bestblogs-sources.json（400+ RSS 订阅）
//   2. 批量抓取各源 RSS，过滤 lookback 窗口内的新条目
//   3. 借助 state-feed.json 去重，写入 feed-bestblogs.json
//
// 【产出】feed-bestblogs.json（按 category 分组的文章/播客/视频/Twitter RSS 条目）
// 【依赖】无 API key；与 generate-feed.js 共用 state-feed.json 做跨次去重
//
// Usage: node generate-bestblogs-feed.js
// Output: ../feed-bestblogs.json
// 文档：docs/generate-feed.zh-CN.md
// ============================================================================

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const SCRIPT_DIR = decodeURIComponent(new URL('.', import.meta.url).pathname);
const SOURCES_PATH = join(SCRIPT_DIR, '..', 'config', 'bestblogs-sources.json');
const OUTPUT_PATH = join(SCRIPT_DIR, '..', 'feed-bestblogs.json');
const STATE_PATH = join(SCRIPT_DIR, '..', 'state-feed.json');

const RSS_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const LOOKBACK_HOURS = 72;
const MAX_ITEMS_PER_SOURCE = 1;
const MAX_TOTAL_PER_CATEGORY = 30;
const FETCH_BATCH_SIZE = 20;
const FETCH_TIMEOUT_MS = 12000;

function decodeXml(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const titleMatch =
      block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
      block.match(/<title>([\s\S]*?)<\/title>/);
    const title = titleMatch ? decodeXml(titleMatch[1]) : 'Untitled';

    const linkMatch =
      block.match(/<link><!\[CDATA\[([\s\S]*?)\]\]><\/link>/) ||
      block.match(/<link>([\s\S]*?)<\/link>/);
    const link = linkMatch ? linkMatch[1].trim() : null;

    const guidMatch =
      block.match(/<guid[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/guid>/) ||
      block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/);
    const guid = guidMatch ? guidMatch[1].trim() : link;

    const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const publishedAt = pubDateMatch
      ? new Date(pubDateMatch[1].trim()).toISOString()
      : null;

    const descMatch =
      block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
      block.match(/<description>([\s\S]*?)<\/description>/) ||
      block.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/) ||
      block.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/);
    const summary = descMatch ? decodeXml(descMatch[1]).slice(0, 500) : '';

    if (guid && link) {
      items.push({ title, guid, link, publishedAt, summary });
    }
  }
  return items;
}

async function loadState() {
  if (!existsSync(STATE_PATH)) {
    return { seenBestblogs: {} };
  }
  try {
    const state = JSON.parse(await readFile(STATE_PATH, 'utf-8'));
    if (!state.seenBestblogs) state.seenBestblogs = {};
    return state;
  } catch {
    return { seenBestblogs: {} };
  }
}

async function fetchRss(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': RSS_USER_AGENT,
        Accept: 'application/rss+xml, application/xml, text/xml, */*'
      }
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const xml = await res.text();
    return { items: parseRssItems(xml) };
  } catch (err) {
    return { error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function processBatch(tasks, handler) {
  const results = [];
  for (let i = 0; i < tasks.length; i += FETCH_BATCH_SIZE) {
    const batch = tasks.slice(i, i + FETCH_BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(handler));
    results.push(...batchResults);
  }
  return results;
}

function withinLookback(publishedAt, cutoff) {
  if (!publishedAt) return true;
  return new Date(publishedAt) >= cutoff;
}

function capAndSort(items) {
  return items
    .sort((a, b) => {
      const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return tb - ta;
    })
    .slice(0, MAX_TOTAL_PER_CATEGORY);
}

async function main() {
  const sources = JSON.parse(await readFile(SOURCES_PATH, 'utf-8'));
  const state = await loadState();
  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
  const errors = [];

  console.error('Fetching BestBlogs RSS feeds (no API keys)...');

  // Articles
  const articleTasks = sources.blogs || [];
  console.error(`  Articles: ${articleTasks.length} sources`);
  const articleResults = await processBatch(articleTasks, async (source) => {
    const { items, error } = await fetchRss(source.rssUrl);
    if (error) {
      errors.push(`Article ${source.name}: ${error}`);
      return [];
    }
    const fresh = items
      .filter((item) => withinLookback(item.publishedAt, cutoff))
      .filter((item) => !state.seenBestblogs[item.guid])
      .slice(0, MAX_ITEMS_PER_SOURCE);
    return fresh.map((item) => {
      state.seenBestblogs[item.guid] = Date.now();
      return {
        source: 'bestblogs',
        attribution: 'bestblogs.dev',
        category: 'article',
        name: source.name,
        title: item.title,
        url: item.link,
        publishedAt: item.publishedAt,
        summary: item.summary
      };
    });
  });
  const articles = capAndSort(articleResults.flat());

  // Podcasts
  const podcastTasks = sources.podcasts || [];
  console.error(`  Podcasts: ${podcastTasks.length} sources`);
  const podcastResults = await processBatch(podcastTasks, async (source) => {
    const { items, error } = await fetchRss(source.rssUrl);
    if (error) {
      errors.push(`Podcast ${source.name}: ${error}`);
      return [];
    }
    const fresh = items
      .filter((item) => withinLookback(item.publishedAt, cutoff))
      .filter((item) => !state.seenBestblogs[item.guid])
      .slice(0, MAX_ITEMS_PER_SOURCE);
    return fresh.map((item) => {
      state.seenBestblogs[item.guid] = Date.now();
      return {
        source: 'bestblogs',
        attribution: 'bestblogs.dev',
        category: 'podcast',
        name: source.name,
        title: item.title,
        url: item.link || source.url,
        publishedAt: item.publishedAt,
        summary: item.summary
      };
    });
  });
  const podcasts = capAndSort(podcastResults.flat());

  // Videos
  const videoTasks = sources.videos || [];
  console.error(`  Videos: ${videoTasks.length} sources`);
  const videoResults = await processBatch(videoTasks, async (source) => {
    const { items, error } = await fetchRss(source.rssUrl);
    if (error) {
      errors.push(`Video ${source.name}: ${error}`);
      return [];
    }
    const fresh = items
      .filter((item) => withinLookback(item.publishedAt, cutoff))
      .filter((item) => !state.seenBestblogs[item.guid])
      .slice(0, MAX_ITEMS_PER_SOURCE);
    return fresh.map((item) => {
      state.seenBestblogs[item.guid] = Date.now();
      return {
        source: 'bestblogs',
        attribution: 'bestblogs.dev',
        category: 'video',
        name: source.name,
        title: item.title,
        url: item.link || source.url,
        publishedAt: item.publishedAt,
        summary: item.summary
      };
    });
  });
  const videos = capAndSort(videoResults.flat());

  // X / Twitter (RSS mirrors)
  const xTasks = sources.x_accounts || [];
  console.error(`  X accounts: ${xTasks.length} sources`);
  const xMap = new Map();
  await processBatch(xTasks, async (source) => {
    const { items, error } = await fetchRss(source.rssUrl);
    if (error) {
      errors.push(`X ${source.handle}: ${error}`);
      return null;
    }
    const fresh = items
      .filter((item) => withinLookback(item.publishedAt, cutoff))
      .filter((item) => !state.seenBestblogs[item.guid])
      .slice(0, MAX_ITEMS_PER_SOURCE);
    if (fresh.length === 0) return null;
    const tweets = fresh.map((item) => {
      state.seenBestblogs[item.guid] = Date.now();
      return {
        text: item.title,
        url: item.link,
        publishedAt: item.publishedAt
      };
    });
    xMap.set(source.handle, {
      source: 'bestblogs',
      attribution: 'bestblogs.dev',
      name: source.name,
      handle: source.handle,
      tweets
    });
    return null;
  });
  const x = [...xMap.values()].slice(0, MAX_TOTAL_PER_CATEGORY);

  // Prune old seen entries (7 days)
  const pruneCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [id, ts] of Object.entries(state.seenBestblogs)) {
    if (ts < pruneCutoff) delete state.seenBestblogs[id];
  }
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));

  const feed = {
    _comment:
      'BestBlogs 扩展 feed。信息源来自 bestblogs.dev 公开 OPML；articles/podcasts/videos/x 为 72 小时内 RSS 新条目。',
    _attribution: sources._attribution,
    generatedAt: new Date().toISOString(),
    lookbackHours: LOOKBACK_HOURS,
    articles,
    podcasts,
    videos,
    x,
    stats: {
      articles: articles.length,
      podcasts: podcasts.length,
      videos: videos.length,
      xAccounts: x.length,
      totalTweets: x.reduce((sum, a) => sum + a.tweets.length, 0),
      total: articles.length + podcasts.length + videos.length + x.reduce((s, a) => s + a.tweets.length, 0)
    },
    errors: errors.length > 0 ? errors.slice(0, 50) : undefined
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(feed, null, 2) + '\n');
  console.error(`Wrote ${OUTPUT_PATH}`);
  console.error(`  articles: ${articles.length}, podcasts: ${podcasts.length}, videos: ${videos.length}, x: ${x.length} accounts`);
  if (errors.length) console.error(`  errors: ${errors.length} (non-fatal)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
