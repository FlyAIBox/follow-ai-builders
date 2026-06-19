#!/usr/bin/env node

// ============================================================================
// Import BestBlogs OPML → config/bestblogs-sources.json
// ============================================================================
// 【定位】中央 feed 流水线的一部分，由 generate-feed.yml 在 all / bestblogs-only
// 模式下调用（npm run import-bestblogs）。用户侧 skill 不运行此脚本。
//
// 【职责】
//   1. 从 ginobefun/BestBlogs 拉取四类 OPML（文章/播客/视频/Twitter RSS）
//   2. 解析 outline 节点，合并为统一的源注册表
//   3. 写入 config/bestblogs-sources.json，供 generate-bestblogs-feed.js 读取
//
// 【产出】config/bestblogs-sources.json、config/bestblogs/opml/ 下的 OPML 副本
// 【依赖】无 API key，仅需 HTTP 访问 GitHub raw 与本地文件读写
//
// Source: https://github.com/ginobefun/BestBlogs (shared by bestblogs.dev)
// Usage: node import-bestblogs-opml.js
// 文档：docs/generate-feed.zh-CN.md
// ============================================================================

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const SCRIPT_DIR = decodeURIComponent(new URL('.', import.meta.url).pathname);
const OPML_DIR = join(SCRIPT_DIR, '..', 'config', 'bestblogs', 'opml');
const OUTPUT_PATH = join(SCRIPT_DIR, '..', 'config', 'bestblogs-sources.json');

const OPML_REMOTE_BASE =
  'https://raw.githubusercontent.com/ginobefun/BestBlogs/main';

const OPML_FILES = {
  articles: 'BestBlogs_RSS_Articles.opml',
  podcasts: 'BestBlogs_RSS_Podcasts.opml',
  videos: 'BestBlogs_RSS_Videos.opml',
  twitters: 'BestBlogs_RSS_Twitters.opml'
};

function decodeXml(text) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseOpmlOutlines(xml) {
  const outlines = [];
  const regex = /<outline\b([^>]*)\/?>/gi;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    const attrs = match[1];
    const title =
      attrs.match(/title="([^"]*)"/)?.[1] ||
      attrs.match(/text="([^"]*)"/)?.[1] ||
      '';
    const xmlUrl = attrs.match(/xmlUrl="([^"]*)"/)?.[1] || '';
    if (!title || !xmlUrl) continue;
    outlines.push({ title: decodeXml(title), xmlUrl: xmlUrl.replace(/^http:/, 'https:') });
  }
  return outlines;
}

function extractTwitterHandle(title) {
  const match = title.match(/\(@([A-Za-z0-9_]+)\)\s*$/);
  return match ? match[1] : null;
}

function youtubeUrlFromRss(rssUrl) {
  const channelMatch = rssUrl.match(/channel_id=([A-Za-z0-9_-]+)/);
  if (channelMatch) {
    return `https://www.youtube.com/channel/${channelMatch[1]}`;
  }
  const playlistMatch = rssUrl.match(/playlist_id=([A-Za-z0-9_-]+)/);
  if (playlistMatch) {
    return `https://www.youtube.com/playlist?list=${playlistMatch[1]}`;
  }
  return rssUrl;
}

async function syncOpmlFromRemote() {
  if (process.argv.includes('--local-only')) return;
  const { mkdir, writeFile: write } = await import('fs/promises');
  await mkdir(OPML_DIR, { recursive: true });
  for (const filename of Object.values(OPML_FILES)) {
    const url = `${OPML_REMOTE_BASE}/${filename}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
    await write(join(OPML_DIR, filename), await res.text());
    console.error(`  synced ${filename}`);
  }
  // Also sync ALL opml if present upstream
  const allUrl = `${OPML_REMOTE_BASE}/BestBlogs_RSS_ALL.opml`;
  const allRes = await fetch(allUrl);
  if (allRes.ok) {
    await write(join(OPML_DIR, 'BestBlogs_RSS_ALL.opml'), await allRes.text());
    console.error('  synced BestBlogs_RSS_ALL.opml');
  }
}

async function main() {
  console.error('Syncing OPML from BestBlogs repo...');
  await syncOpmlFromRemote();

  const articlesRaw = await readFile(join(OPML_DIR, OPML_FILES.articles), 'utf-8');
  const podcastsRaw = await readFile(join(OPML_DIR, OPML_FILES.podcasts), 'utf-8');
  const videosRaw = await readFile(join(OPML_DIR, OPML_FILES.videos), 'utf-8');
  const twittersRaw = await readFile(join(OPML_DIR, OPML_FILES.twitters), 'utf-8');

  const articles = parseOpmlOutlines(articlesRaw).map(({ title, xmlUrl }) => ({
    name: title,
    type: 'rss',
    rssUrl: xmlUrl,
    source: 'bestblogs',
    attribution: 'bestblogs.dev'
  }));

  const podcasts = parseOpmlOutlines(podcastsRaw).map(({ title, xmlUrl }) => ({
    name: title,
    rssUrl: xmlUrl,
    url: xmlUrl,
    source: 'bestblogs',
    attribution: 'bestblogs.dev',
    focus: '来自 bestblogs.dev 精选播客。'
  }));

  const videos = parseOpmlOutlines(videosRaw).map(({ title, xmlUrl }) => ({
    name: title,
    rssUrl: xmlUrl,
    url: youtubeUrlFromRss(xmlUrl),
    source: 'bestblogs',
    attribution: 'bestblogs.dev',
    focus: '来自 bestblogs.dev 精选视频频道。'
  }));

  const x_accounts = [];
  for (const { title, xmlUrl } of parseOpmlOutlines(twittersRaw)) {
    const handle = extractTwitterHandle(title);
    if (!handle) continue;
    const displayName = title.replace(/\(@[A-Za-z0-9_]+\)\s*$/, '').trim();
    x_accounts.push({
      name: displayName || handle,
      handle,
      fetchMethod: 'rss',
      rssUrl: xmlUrl,
      source: 'bestblogs',
      attribution: 'bestblogs.dev'
    });
  }

  const output = {
    _comment:
      'BestBlogs 扩展信息源。由 scripts/import-bestblogs-opml.js 从 OPML 生成，请勿手改条目；更新 OPML 后重新运行 import 脚本。',
    _attribution: {
      project: 'BestBlogs',
      attribution_zh: '信息源 OPML 来自 bestblogs.dev 的公开分享',
      attribution_en: 'OPML subscriptions shared publicly by bestblogs.dev',
      website: 'https://bestblogs.dev',
      repository: 'https://github.com/ginobefun/BestBlogs',
      article: 'https://www.ginonotes.com/posts/bestblogs-sources-part2-podcasts-videos',
      philosophy_zh: '追踪那些真正在做产品、有独立见解的建造者（Builders），而非只会搬运信息的网红（Influencers）。',
      philosophy_en: 'Follow builders who ship products and share original opinions — not influencers who only repackage news.'
    },
    _opml_files: {
      all: 'config/bestblogs/opml/BestBlogs_RSS_ALL.opml',
      articles: 'config/bestblogs/opml/BestBlogs_RSS_Articles.opml',
      podcasts: 'config/bestblogs/opml/BestBlogs_RSS_Podcasts.opml',
      videos: 'config/bestblogs/opml/BestBlogs_RSS_Videos.opml',
      twitters: 'config/bestblogs/opml/BestBlogs_RSS_Twitters.opml'
    },
    stats: {
      articles: articles.length,
      podcasts: podcasts.length,
      videos: videos.length,
      x_accounts: x_accounts.length,
      total: articles.length + podcasts.length + videos.length + x_accounts.length
    },
    blogs: articles,
    podcasts,
    videos,
    x_accounts
  };

  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.error(`Wrote ${OUTPUT_PATH}`);
  console.error(`  articles (blogs/rss): ${articles.length}`);
  console.error(`  podcasts: ${podcasts.length}`);
  console.error(`  videos: ${videos.length}`);
  console.error(`  x_accounts (rss): ${x_accounts.length}`);
  console.error(`  total: ${output.stats.total}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
