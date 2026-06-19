#!/usr/bin/env node

// ============================================================================
// Follow Builders — Central Feed Generator
// ============================================================================
// Runs on GitHub Actions (every 30 minutes) to fetch content and publish
// feed-x.json, feed-podcasts.json, and feed-blogs.json.
//
// Deduplication: tracks previously seen tweet IDs, episode GUIDs, and article
// URLs in state-feed.json so content is never repeated across runs.
//
// Usage: node generate-feed.js [--tweets-only | --podcasts-only | --blogs-only]
// Env vars needed: X_BEARER_TOKEN, POD2TXT_API_KEY
//
// 中文维护说明：
// 这个脚本属于“中心 feed 生成端”，通常由维护者或 GitHub Actions 定时运行。
// 它会把多个外部来源规范化成三个稳定 JSON feed，供用户侧 prepare-digest.js
// 读取。这里不做 LLM 摘要，只做抓取、去重、结构化和错误收集。
//
// 面向“热点 AI / Agent / GPU 高质量信息聚合”的优化入口主要有三处：
// 1. config/default-sources.json：调整跟踪谁、哪些播客、哪些官方博客。
// 2. 下方 lookback/max 常量：控制热点窗口、单源数量和噪音上限。
// 3. prompts/*.md：控制 LLM 如何判断重要性、技术含量和可操作性。
// ============================================================================

import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

// -- Constants ---------------------------------------------------------------

const POD2TXT_BASE = "https://pod2txt.vercel.app/api";
const X_API_BASE = "https://api.x.com/2";
// Some RSS hosts (notably Substack) block non-browser user agents from cloud IPs.
// Using a real Chrome UA avoids 403 errors in GitHub Actions.
const RSS_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
// 热点窗口：X 保持 24 小时以捕捉当天讨论，播客窗口更长以覆盖周更节目，
// 博客窗口居中，避免官方文章因发布时间差异被漏掉。
const TWEET_LOOKBACK_HOURS = 24;
const PODCAST_LOOKBACK_HOURS = 336; // 14 days — podcasts publish weekly/biweekly, not daily
const BLOG_LOOKBACK_HOURS = 72;
// 单个来源的上限用于控制噪音：高质量摘要更需要“精选”，而不是把所有内容
// 原样塞给 LLM。需要更强热点覆盖时，可以先扩源，再谨慎提高这些上限。
const MAX_TWEETS_PER_USER = 3;
const MAX_ARTICLES_PER_BLOG = 3;
const X_USER_LOOKUP_BATCH_SIZE = 5;
const X_RETRY_STATUSES = new Set([500, 502, 503, 504]);
const X_RETRY_ATTEMPTS = 3;

// State file lives in the repo root so it gets committed by GitHub Actions
const SCRIPT_DIR = decodeURIComponent(new URL(".", import.meta.url).pathname);
const STATE_PATH = join(SCRIPT_DIR, "..", "state-feed.json");

// -- State Management --------------------------------------------------------

// Tracks which tweet IDs and video IDs we've already included in feeds
// so we never send the same content twice across runs.

async function loadState() {
  if (!existsSync(STATE_PATH)) {
    return { seenTweets: {}, seenVideos: {}, seenArticles: {} };
  }
  try {
    const state = JSON.parse(await readFile(STATE_PATH, "utf-8"));
    // Ensure seenArticles exists for older state files
    // 兼容老版本 state-feed.json，避免新增博客去重后旧文件直接报错。
    if (!state.seenArticles) state.seenArticles = {};
    return state;
  } catch {
    return { seenTweets: {}, seenVideos: {}, seenArticles: {} };
  }
}

async function saveState(state) {
  // Prune entries older than 7 days to prevent the file from growing forever
  // 只需要防止短期重复即可，过旧 ID 定期清理，避免 state 文件无限增长。
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [id, ts] of Object.entries(state.seenTweets)) {
    if (ts < cutoff) delete state.seenTweets[id];
  }
  for (const [id, ts] of Object.entries(state.seenVideos)) {
    if (ts < cutoff) delete state.seenVideos[id];
  }
  for (const [id, ts] of Object.entries(state.seenArticles || {})) {
    if (ts < cutoff) delete state.seenArticles[id];
  }
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

// -- Load Sources ------------------------------------------------------------

async function loadSources() {
  // 信息源注册表是质量控制的第一道门：优先加入一手建设者、官方团队、
  // Agent 工具链、推理/GPU/基础设施相关的高信号来源。
  const sourcesPath = join(SCRIPT_DIR, "..", "config", "default-sources.json");
  return JSON.parse(await readFile(sourcesPath, "utf-8"));
}

// -- Podcast Fetching (RSS + pod2txt) ----------------------------------------

// Parses an RSS feed XML string and returns episode objects with
// title, publishedAt, guid, and link. RSS feeds list newest first.
function parseRssFeed(xml) {
  const episodes = [];
  // Match each <item> block in the RSS feed
  // 这里使用轻量正则解析 RSS，原因是脚本依赖尽量少，适合 GitHub Actions。
  // 如果后续要支持更多复杂 feed，可以替换成 XML parser。
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const block = itemMatch[1];

    // Extract title (inside CDATA or plain text)
    const titleMatch =
      block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
      block.match(/<title>([\s\S]*?)<\/title>/);
    const title = titleMatch ? titleMatch[1].trim() : "Untitled";

    // Extract GUID (unique episode identifier), stripping CDATA wrapper if present
    const guidMatch =
      block.match(/<guid[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/guid>/) ||
      block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/);
    const guid = guidMatch ? guidMatch[1].trim() : null;

    // Extract publish date
    const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const publishedAt = pubDateMatch
      ? new Date(pubDateMatch[1].trim()).toISOString()
      : null;

    // Extract episode link (for the feed output URL)
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
    const link = linkMatch ? linkMatch[1].trim() : null;

    if (guid) {
      episodes.push({ title, guid, publishedAt, link });
    }
  }
  return episodes;
}

// -- YouTube Episode URL Lookup ----------------------------------------------
// Podcast RSS feeds don't know about YouTube, so to get the exact YouTube
// video URL for an episode we look up the channel's recent videos and match
// by title. Free, no API key required. Tries Atom RSS first (stable but
// returns 500 for some channels), falls back to scraping the /videos page.

// Derives a YouTube Atom feed URL from a channel or playlist URL.
// Handles three URL shapes: /@handle, /channel/UCxxx, /playlist?list=PLxxx.
async function getYouTubeFeedUrl(channelUrl) {
  if (!channelUrl || !channelUrl.includes("youtube.com")) return null;

  // 播放列表可以直接转换为 YouTube Atom feed，稳定且无需 API key。
  const playlistMatch = channelUrl.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (playlistMatch) {
    return `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistMatch[1]}`;
  }

  const channelIdMatch = channelUrl.match(/\/channel\/(UC[A-Za-z0-9_-]+)/);
  if (channelIdMatch) {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelIdMatch[1]}`;
  }

  // /@handle URLs need a round-trip: fetch the channel page and pull the
  // channelId out of its HTML. YouTube embeds it in several places; the
  // "channelId":"UC..." pattern in the JSON blob is the most reliable.
  if (channelUrl.match(/\/@[A-Za-z0-9_.-]+/)) {
    try {
      const res = await fetch(channelUrl, {
        headers: {
          "User-Agent": RSS_USER_AGENT,
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      const html = await res.text();
      const idMatch =
        html.match(/"channelId":"(UC[A-Za-z0-9_-]{20,})"/) ||
        html.match(
          /<meta\s+itemprop="(?:identifier|channelId)"\s+content="(UC[A-Za-z0-9_-]{20,})"/,
        );
      if (idMatch) {
        return `https://www.youtube.com/feeds/videos.xml?channel_id=${idMatch[1]}`;
      }
    } catch {
      return null;
    }
  }
  return null;
}

// Scrapes recent videos from a YouTube channel's /videos page by parsing
// the ytInitialData JSON embedded in the HTML. Used as a fallback when the
// Atom RSS endpoint is unavailable. YouTube's internal data shapes change
// occasionally, so we defensively navigate both the rich-grid (channel page)
// and playlist-video-list (playlist page) structures.
function parseYouTubePageData(html) {
  const videos = [];
  const m = html.match(/var\s+ytInitialData\s*=\s*({[\s\S]*?});\s*<\/script>/);
  if (!m) return videos;

  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return videos;
  }

  // YouTube 页面结构经常调整，所以这里用可选链逐层探测；
  // 解析失败时返回空数组，让上层回退到播客频道 URL。
  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  for (const tab of tabs) {
    const gridItems =
      tab?.tabRenderer?.content?.richGridRenderer?.contents || [];
    for (const it of gridItems) {
      const v = it?.richItemRenderer?.content?.videoRenderer;
      if (v?.videoId) {
        const title = v.title?.runs?.[0]?.text || v.title?.simpleText || "";
        if (title) {
          videos.push({
            title,
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
          });
        }
      }
    }
    if (videos.length > 0) break;

    const playlistItems =
      tab?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]
        ?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer
        ?.contents || [];
    for (const it of playlistItems) {
      const v = it?.playlistVideoRenderer;
      if (v?.videoId) {
        const title = v.title?.runs?.[0]?.text || v.title?.simpleText || "";
        if (title) {
          videos.push({
            title,
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
          });
        }
      }
    }
    if (videos.length > 0) break;
  }
  return videos;
}

// Fetches recent videos for a YouTube channel/playlist URL. Tries the Atom
// feed first, then scrapes the /videos page if the feed is unavailable.
async function fetchYouTubeVideos(channelUrl) {
  const feedUrl = await getYouTubeFeedUrl(channelUrl);
  if (feedUrl) {
    try {
      const res = await fetch(feedUrl, {
        headers: { "User-Agent": RSS_USER_AGENT },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const videos = parseYouTubeFeed(await res.text());
        if (videos.length > 0) return videos;
      }
    } catch {
      // fall through to scraping
    }
  }

  if (!channelUrl || !channelUrl.includes("youtube.com")) return [];
  // Playlist URLs should not be mutated; channel URLs need /videos appended
  // so we hit the uploads grid rather than the channel home/shorts page.
  const videosPageUrl = channelUrl.includes("/playlist?")
    ? channelUrl
    : channelUrl.replace(/\/$/, "") + "/videos";
  try {
    const res = await fetch(videosPageUrl, {
      headers: {
        "User-Agent": RSS_USER_AGENT,
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    return parseYouTubePageData(await res.text());
  } catch {
    return [];
  }
}

// Parses a YouTube Atom feed and returns { title, url } for each entry.
function parseYouTubeFeed(xml) {
  const videos = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let entryMatch;
  while ((entryMatch = entryRegex.exec(xml)) !== null) {
    const block = entryMatch[1];
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const videoIdMatch = block.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/);
    if (titleMatch && videoIdMatch) {
      videos.push({
        title: titleMatch[1].trim(),
        url: `https://www.youtube.com/watch?v=${videoIdMatch[1].trim()}`,
      });
    }
  }
  return videos;
}

// Lowercase, strip punctuation, collapse whitespace — so minor title
// differences between a podcast feed and its YouTube upload don't block a match.
function normalizeTitle(t) {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Finds the YouTube video whose title best matches the podcast episode title.
// Uses substring match first, then token overlap (>=50% of episode's content
// words must appear in the video title). Returns null if no confident match.
async function findYouTubeEpisodeUrl(channelUrl, episodeTitle) {
  const videos = await fetchYouTubeVideos(channelUrl);
  if (videos.length === 0) return null;

  const needle = normalizeTitle(episodeTitle);
  const needleTokens = new Set(needle.split(" ").filter((w) => w.length > 2));
  if (needleTokens.size === 0) return null;

  let bestUrl = null;
  let bestScore = 0;
  for (const v of videos) {
    const hay = normalizeTitle(v.title);
    if (hay && (hay.includes(needle) || needle.includes(hay))) {
      return v.url;
    }
    const hayTokens = new Set(hay.split(" ").filter((w) => w.length > 2));
    let overlap = 0;
    for (const tok of needleTokens) if (hayTokens.has(tok)) overlap++;
    const score = overlap / needleTokens.size;
    if (score > bestScore) {
      bestScore = score;
      bestUrl = v.url;
    }
  }
  return bestScore >= 0.5 ? bestUrl : null;
}

// Fetches a transcript from pod2txt. The API is async: first request may
// return "processing", so we poll until "ready" (up to 5 attempts, ~2.5 min).
async function fetchPod2txtTranscript(rssUrl, guid, apiKey) {
  const maxAttempts = 5;
  const pollInterval = 30000; // 30 seconds between polls

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // pod2txt 是异步转录服务，同一个 guid 第一次请求可能只是启动任务。
    // 轮询可以提高成功率，但总尝试次数受限，避免 CI 被单集播客卡住。
    const res = await fetch(`${POD2TXT_BASE}/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedurl: rssUrl, guid, apikey: apiKey }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { error: `HTTP ${res.status}: ${text}` };
    }

    const data = await res.json();

    if (data.status === "ready" && data.url) {
      // Transcript is ready — fetch the text from the provided URL
      const txtRes = await fetch(data.url);
      if (!txtRes.ok)
        return {
          error: `Failed to fetch transcript text: HTTP ${txtRes.status}`,
        };
      const transcript = await txtRes.text();
      return { transcript };
    }

    if (data.status === "processing") {
      console.error(
        `      pod2txt: processing (attempt ${attempt}/${maxAttempts}), waiting ${pollInterval / 1000}s...`,
      );
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, pollInterval));
      }
      continue;
    }

    // Unexpected status or error from the API
    return { error: data.message || `Unexpected status: ${data.status}` };
  }

  return { error: "Timed out waiting for transcript processing" };
}

// Main podcast fetching function. For each podcast:
// 1. Fetches the RSS feed to discover episodes
// 2. Filters by lookback window and dedup
// 3. Fetches transcript via pod2txt for the newest unseen episode
async function fetchPodcastContent(podcasts, apiKey, state, errors) {
  const cutoff = new Date(Date.now() - PODCAST_LOOKBACK_HOURS * 60 * 60 * 1000);
  const allCandidates = [];

  // Step 1: Discover episodes from each podcast's RSS feed
  // 先收集所有候选，再统一按发布时间排序，这样不会因为某个播客排在配置前面
  // 就抢占当天唯一的播客摘要名额。
  for (const podcast of podcasts) {
    if (!podcast.rssUrl) {
      errors.push(`Podcast: No rssUrl configured for ${podcast.name}`);
      continue;
    }

    try {
      console.error(`  Fetching RSS for ${podcast.name}...`);
      const rssRes = await fetch(podcast.rssUrl, {
        headers: {
          "User-Agent": RSS_USER_AGENT,
          Accept: "application/rss+xml, application/xml, text/xml, */*",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
        signal: AbortSignal.timeout(30000), // 30 second timeout for large feeds
      });

      if (!rssRes.ok) {
        console.error(
          `  ${podcast.name}: RSS fetch failed — HTTP ${rssRes.status}`,
        );
        errors.push(
          `Podcast: Failed to fetch RSS for ${podcast.name}: HTTP ${rssRes.status}`,
        );
        continue;
      }

      const rssXml = await rssRes.text();
      const episodes = parseRssFeed(rssXml);
      console.error(
        `  ${podcast.name}: found ${episodes.length} episodes in RSS feed`,
      );

      // Check the 3 most recent episodes, skip already-seen ones
      // 只检查最近 3 集：播客 feed 可能很长，热点摘要只需要近期候选。
      for (const episode of episodes.slice(0, 3)) {
        if (state.seenVideos[episode.guid]) {
          console.error(`    Skipping "${episode.title}" (already seen)`);
          continue;
        }

        console.error(
          `    Candidate: "${episode.title}" published=${episode.publishedAt || "unknown"}`,
        );
        allCandidates.push({ podcast, ...episode });
      }
    } catch (err) {
      errors.push(`Podcast: Error processing ${podcast.name}: ${err.message}`);
    }
  }

  console.error(
    `  Total candidates: ${allCandidates.length}, cutoff: ${cutoff.toISOString()}`,
  );

  // Step 2: Filter by lookback window, sort newest first
  const withinWindow = allCandidates
    .filter((v) => !v.publishedAt || new Date(v.publishedAt) >= cutoff)
    .sort((a, b) => {
      // Newest first; dateless ones go to the end
      if (a.publishedAt && b.publishedAt)
        return new Date(b.publishedAt) - new Date(a.publishedAt);
      if (a.publishedAt) return -1;
      if (b.publishedAt) return 1;
      return 0;
    });

  console.error(`  Within window: ${withinWindow.length} episode(s)`);
  for (const v of withinWindow) {
    console.error(`    - "${v.title}" published=${v.publishedAt || "unknown"}`);
  }

  // Step 3: Try each candidate until we get a transcript from pod2txt
  // 只返回第一集成功转录的内容，控制 feed 体积和 LLM 摘要成本。
  for (const selected of withinWindow) {
    console.error(`    Fetching transcript for "${selected.title}"...`);

    const result = await fetchPod2txtTranscript(
      selected.podcast.rssUrl,
      selected.guid,
      apiKey,
    );

    // Mark as seen regardless so we don't retry failed episodes daily
    state.seenVideos[selected.guid] = Date.now();

    if (result.error) {
      console.error(
        `    Transcript error: ${result.error} — skipping to next candidate`,
      );
      errors.push(
        `Podcast: Transcript error for "${selected.title}": ${result.error}`,
      );
      continue;
    }

    if (!result.transcript) {
      console.error(
        `    Empty transcript for "${selected.title}" — skipping to next candidate`,
      );
      continue;
    }

    console.error(
      `    Selected: "${selected.title}" (transcript: ${result.transcript.length} chars)`,
    );

    // Try to resolve the exact YouTube video URL for this episode. If the
    // lookup fails (no YouTube channel configured, no title match, network
    // error), fall back to the channel URL so the feed still works.
    const youtubeUrl = await findYouTubeEpisodeUrl(
      selected.podcast.url,
      selected.title,
    );
    if (youtubeUrl) {
      console.error(`    Matched YouTube episode URL: ${youtubeUrl}`);
    } else {
      console.error(
        `    No YouTube episode match found — falling back to channel URL`,
      );
    }

    return [
      {
        source: "podcast",
        name: selected.podcast.name,
        focus: selected.podcast.focus || "",
        title: selected.title,
        guid: selected.guid,
        url: youtubeUrl || selected.podcast.url,
        publishedAt: selected.publishedAt,
        transcript: result.transcript,
      },
    ];
  }

  console.error(`    No candidates had transcripts available`);
  return [];
}

// -- X/Twitter Fetching (Official API v2) ------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchXWithRetry(url, options) {
  // X API 偶发 5xx 时重试；429 不重试，因为它通常代表配额耗尽。
  let lastResponse;
  for (let attempt = 1; attempt <= X_RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, options);
      lastResponse = res;
      if (!X_RETRY_STATUSES.has(res.status) || attempt === X_RETRY_ATTEMPTS) {
        return res;
      }
    } catch (err) {
      if (attempt === X_RETRY_ATTEMPTS) throw err;
    }
    await sleep(1000 * attempt);
  }
  return lastResponse;
}

async function fetchXContent(xAccounts, bearerToken, state, errors) {
  const results = [];
  const cutoff = new Date(Date.now() - TWEET_LOOKBACK_HOURS * 60 * 60 * 1000);

  // Batch lookup user IDs. Smaller batches make one flaky X response less likely
  // to wipe out the whole feed.
  // 账号查 ID 和拉取 tweets 分开做，便于把单个失败记录为非致命错误。
  const handles = xAccounts.map((a) => a.handle);
  let userMap = {};

  for (let i = 0; i < handles.length; i += X_USER_LOOKUP_BATCH_SIZE) {
    const batch = handles.slice(i, i + X_USER_LOOKUP_BATCH_SIZE);
    try {
      const res = await fetchXWithRetry(
        `${X_API_BASE}/users/by?usernames=${batch.join(",")}&user.fields=name,description`,
        { headers: { Authorization: `Bearer ${bearerToken}` } },
      );

      if (!res.ok) {
        errors.push(
          `X API: User lookup failed for ${batch.join(",")}: HTTP ${res.status}`,
        );
        continue;
      }

      const data = await res.json();
      for (const user of data.data || []) {
        userMap[user.username.toLowerCase()] = {
          id: user.id,
          name: user.name,
          description: user.description || "",
        };
      }
      if (data.errors) {
        for (const err of data.errors) {
          errors.push(`X API: User not found: ${err.value || err.detail}`);
        }
      }
    } catch (err) {
      errors.push(`X API: User lookup error: ${err.message}`);
    }
  }

  // Fetch recent tweets per user (max 3, exclude retweets/replies)
  for (const account of xAccounts) {
    const userData = userMap[account.handle.toLowerCase()];
    if (!userData) continue;

    try {
      const res = await fetchXWithRetry(
        `${X_API_BASE}/users/${userData.id}/tweets?` +
          `max_results=5` + // fetch 5, then filter to 3 new ones
          `&tweet.fields=created_at,public_metrics,referenced_tweets,note_tweet` +
          `&exclude=retweets,replies` +
          `&start_time=${cutoff.toISOString()}`,
        { headers: { Authorization: `Bearer ${bearerToken}` } },
      );

      if (!res.ok) {
        if (res.status === 429) {
          errors.push(`X API: Rate limited, skipping remaining accounts`);
          break;
        }
        errors.push(
          `X API: Failed to fetch tweets for @${account.handle}: HTTP ${res.status}`,
        );
        continue;
      }

      const data = await res.json();
      const allTweets = data.data || [];

      // Filter out already-seen tweets, cap at 3
      // 排除回复和转推后，仍可能有低信息量 quote。这里保留原始信号，
      // 由 prompts 中的编辑规则决定是否进入最终摘要。
      const newTweets = [];
      for (const t of allTweets) {
        if (state.seenTweets[t.id]) continue; // dedup
        if (newTweets.length >= MAX_TWEETS_PER_USER) break;

        newTweets.push({
          id: t.id,
          // note_tweet.text has the full untruncated text for long tweets (>280 chars)
          text: t.note_tweet?.text || t.text,
          createdAt: t.created_at,
          url: `https://x.com/${account.handle}/status/${t.id}`,
          likes: t.public_metrics?.like_count || 0,
          retweets: t.public_metrics?.retweet_count || 0,
          replies: t.public_metrics?.reply_count || 0,
          isQuote:
            t.referenced_tweets?.some((r) => r.type === "quoted") || false,
          quotedTweetId:
            t.referenced_tweets?.find((r) => r.type === "quoted")?.id || null,
        });

        // Mark as seen
        state.seenTweets[t.id] = Date.now();
      }

      if (newTweets.length === 0) continue;

      results.push({
        source: "x",
        name: account.name,
        handle: account.handle,
        focus: account.focus || "",
        bio: userData.description,
        tweets: newTweets,
      });

      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      errors.push(`X API: Error fetching @${account.handle}: ${err.message}`);
    }
  }

  return results;
}

// -- Blog Fetching (HTML scraping) -------------------------------------------

// Scrapes the Anthropic Engineering blog index page.
// The page is a Next.js app that embeds article data as JSON in <script> tags.
// We parse that JSON to extract article metadata (title, slug, date, summary).
// Falls back to regex-based HTML parsing if the JSON approach fails.
function parseAnthropicEngineeringIndex(html) {
  const articles = [];

  // Strategy 1: Look for article data in Next.js __NEXT_DATA__ script tag
  // 官方博客通常比社交媒体更接近一手信息，尤其适合捕捉模型、Agent、
  // 推理基础设施和产品发布的正式细节。
  const nextDataMatch = html.match(
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      // Navigate the Next.js page props to find article entries
      const pageProps = data?.props?.pageProps;
      const posts =
        pageProps?.posts || pageProps?.articles || pageProps?.entries || [];
      for (const post of posts) {
        const slug = post.slug?.current || post.slug || "";
        articles.push({
          title: post.title || "Untitled",
          url: `https://www.anthropic.com/engineering/${slug}`,
          publishedAt:
            post.publishedOn || post.publishedAt || post.date || null,
          description: post.summary || post.description || "",
        });
      }
      if (articles.length > 0) return articles;
    } catch {
      // JSON parsing failed, fall through to regex approach
    }
  }

  // Strategy 2: Regex-based extraction from the rendered HTML.
  // Anthropic engineering articles follow the pattern /engineering/<slug>
  const linkRegex = /href="\/engineering\/([a-z0-9-]+)"/gi;
  const seenSlugs = new Set();
  let linkMatch;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    const slug = linkMatch[1];
    if (seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    articles.push({
      title: "", // Will be filled when we fetch the article page
      url: `https://www.anthropic.com/engineering/${slug}`,
      publishedAt: null,
      description: "",
    });
  }
  return articles;
}

// Scrapes the Claude Blog index page (claude.com/blog).
// This is a Webflow site. We extract article links, titles, and dates
// from the HTML structure.
function parseClaudeBlogIndex(html) {
  const articles = [];
  const seenSlugs = new Set();

  // Match blog post links — they follow the pattern /blog/<slug>
  // We capture surrounding context to extract titles and dates
  const linkRegex = /href="\/blog\/([a-z0-9-]+)"/gi;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    const slug = linkMatch[1];
    if (seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);
    articles.push({
      title: "", // Will be filled when we fetch the article page
      url: `https://claude.com/blog/${slug}`,
      publishedAt: null,
      description: "",
    });
  }
  return articles;
}

// Extracts the main text content from an Anthropic Engineering article page.
// Tries the embedded JSON first (Next.js SSR data), then falls back to
// stripping HTML tags from the article body.
function extractAnthropicArticleContent(html) {
  let title = "";
  let author = "";
  let publishedAt = null;
  let content = "";

  // Try to get structured data from Next.js __NEXT_DATA__
  // 结构化数据优先，可以减少导航栏、页脚和推荐文章混入正文。
  const nextDataMatch = html.match(
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const pageProps = data?.props?.pageProps;
      const post =
        pageProps?.post || pageProps?.article || pageProps?.entry || pageProps;
      title = post?.title || "";
      author = post?.author?.name || post?.authors?.[0]?.name || "";
      publishedAt =
        post?.publishedOn || post?.publishedAt || post?.date || null;

      // Extract text from the body blocks (Sanity CMS portable text format)
      const body = post?.body || post?.content || [];
      if (Array.isArray(body)) {
        const textParts = [];
        for (const block of body) {
          if (block._type === "block" && block.children) {
            const text = block.children.map((c) => c.text || "").join("");
            if (text.trim()) textParts.push(text.trim());
          }
        }
        content = textParts.join("\n\n");
      }
      if (content) return { title, author, publishedAt, content };
    } catch {
      // Fall through to HTML stripping
    }
  }

  // Fallback: extract title from <h1> and body from <article> or main content
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) title = h1Match[1].replace(/<[^>]+>/g, "").trim();

  // Try to find the article body and strip HTML tags
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const bodyHtml = articleMatch ? articleMatch[1] : html;

  // Strip script/style tags first, then all remaining HTML tags
  content = bodyHtml
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { title, author, publishedAt, content };
}

// Extracts the main text content from a Claude Blog article page.
// Uses JSON-LD schema data if present, then falls back to the rich text body.
function extractClaudeBlogArticleContent(html) {
  let title = "";
  let author = "";
  let publishedAt = null;
  let content = "";

  // Try JSON-LD structured data first (most reliable for metadata)
  // JSON-LD 通常提供标题、作者和发布时间；正文仍需要从页面富文本区提取。
  const jsonLdRegex =
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLdMatch;
  while ((jsonLdMatch = jsonLdRegex.exec(html)) !== null) {
    try {
      const ld = JSON.parse(jsonLdMatch[1]);
      if (ld["@type"] === "BlogPosting" || ld["@type"] === "Article") {
        title = ld.headline || ld.name || "";
        author = ld.author?.name || "";
        publishedAt = ld.datePublished || null;
        break;
      }
    } catch {
      // Not valid JSON-LD, skip
    }
  }

  // Extract body text from the Webflow rich text container
  const richTextMatch =
    html.match(
      /<div[^>]*class="[^"]*u-rich-text-blog[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i,
    ) ||
    html.match(/<div[^>]*class="[^"]*w-richtext[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

  if (richTextMatch) {
    content = richTextMatch[1]
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // If rich text extraction failed, try a broader approach
  if (!content) {
    // Get title from <h1> if not already found
    if (!title) {
      const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
      if (h1Match) title = h1Match[1].replace(/<[^>]+>/g, "").trim();
    }

    // Strip the whole page down to text as a last resort
    content = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return { title, author, publishedAt, content };
}

// Main blog fetching orchestrator.
// For each blog source in the config, discovers new articles, deduplicates
// against previously seen URLs, fetches full article content, and returns
// the results for feed-blogs.json.
async function fetchBlogContent(blogs, state, errors) {
  const results = [];
  const cutoff = new Date(Date.now() - BLOG_LOOKBACK_HOURS * 60 * 60 * 1000);

  for (const blog of blogs) {
    console.error(`  Processing blog: ${blog.name}...`);
    let candidates = [];

    try {
      // Step 1: Discover articles from the blog index page
      // 先从索引页发现 URL，再进入正文页提取全文，避免只摘要列表页简介。
      const indexRes = await fetch(blog.indexUrl, {
        headers: { "User-Agent": "FollowBuilders/1.0 (feed aggregator)" },
      });
      if (!indexRes.ok) {
        errors.push(
          `Blog: Failed to fetch index for ${blog.name}: HTTP ${indexRes.status}`,
        );
        continue;
      }
      const indexHtml = await indexRes.text();

      // Use the right parser based on which blog this is
      if (blog.indexUrl.includes("anthropic.com")) {
        candidates = parseAnthropicEngineeringIndex(indexHtml);
      } else if (blog.indexUrl.includes("claude.com")) {
        candidates = parseClaudeBlogIndex(indexHtml);
      }

      // Step 2: Filter to unseen articles, cap at MAX_ARTICLES_PER_BLOG.
      // Blog index pages list articles newest-first. We only consider the
      // first few entries (MAX_INDEX_SCAN) to avoid crawling the entire
      // backlog on first run. Articles with a known date must fall within
      // the lookback window; articles without dates are accepted if they
      // appear near the top of the listing (likely recent).
      const MAX_INDEX_SCAN = MAX_ARTICLES_PER_BLOG; // only look at the N most recent entries
      const newArticles = [];
      for (const article of candidates.slice(0, MAX_INDEX_SCAN)) {
        if (state.seenArticles[article.url]) continue; // already seen
        // If we have a date, check it's within the lookback window
        if (article.publishedAt && new Date(article.publishedAt) < cutoff)
          continue;
        newArticles.push(article);
        if (newArticles.length >= MAX_ARTICLES_PER_BLOG) break;
      }

      if (newArticles.length === 0) {
        console.error(`    No new articles found`);
        continue;
      }

      console.error(
        `    Found ${newArticles.length} new article(s), fetching content...`,
      );

      // Step 3: Fetch full article content for each new article
      for (const article of newArticles) {
        try {
          // Fetch the full article page
          const articleRes = await fetch(article.url, {
            headers: { "User-Agent": "FollowBuilders/1.0 (feed aggregator)" },
          });
          if (!articleRes.ok) {
            errors.push(
              `Blog: Failed to fetch article ${article.url}: HTTP ${articleRes.status}`,
            );
            continue;
          }
          const articleHtml = await articleRes.text();

          // Use the right content extractor based on the blog
          let extracted;
          if (article.url.includes("anthropic.com/engineering")) {
            extracted = extractAnthropicArticleContent(articleHtml);
          } else if (article.url.includes("claude.com/blog")) {
            extracted = extractClaudeBlogArticleContent(articleHtml);
          }

          if (!extracted || !extracted.content) {
            errors.push(`Blog: No content extracted from ${article.url}`);
            continue;
          }

          // Merge extracted data with what we already have from the index
          // feed 中保留全文 content，LLM 可以判断文章技术含量，而不只看标题。
          results.push({
            source: "blog",
            name: blog.name,
            focus: blog.focus || "",
            title: extracted.title || article.title || "Untitled",
            url: article.url,
            publishedAt: extracted.publishedAt || article.publishedAt || null,
            author: extracted.author || "",
            description: article.description || "",
            content: extracted.content,
          });

          // Mark as seen
          state.seenArticles[article.url] = Date.now();

          // Small delay between article fetches to be polite
          await new Promise((r) => setTimeout(r, 500));
        } catch (err) {
          errors.push(
            `Blog: Error fetching article ${article.url}: ${err.message}`,
          );
        }
      }
    } catch (err) {
      errors.push(`Blog: Error processing ${blog.name}: ${err.message}`);
    }
  }

  return results;
}

// -- Main --------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const tweetsOnly = args.includes("--tweets-only");
  const podcastsOnly = args.includes("--podcasts-only");
  const blogsOnly = args.includes("--blogs-only");

  // If a specific --*-only flag is set, only that feed type runs.
  // If no flag is set, all three run.
  // 分类型运行便于调试某一路抓取，也便于在 CI 中拆分配额敏感任务。
  const runTweets = tweetsOnly || (!podcastsOnly && !blogsOnly);
  const runPodcasts = podcastsOnly || (!tweetsOnly && !blogsOnly);
  const runBlogs = blogsOnly || (!tweetsOnly && !podcastsOnly);

  const xBearerToken = process.env.X_BEARER_TOKEN;
  const pod2txtKey = process.env.POD2TXT_API_KEY;

  if (runPodcasts && !pod2txtKey) {
    console.error("POD2TXT_API_KEY not set");
    process.exit(1);
  }
  if (runTweets && !xBearerToken) {
    console.error("X_BEARER_TOKEN not set");
    process.exit(1);
  }

  const sources = await loadSources();
  const state = await loadState();
  const errors = [];

  // Fetch tweets
  // 每个 feed 都独立写文件；某一路失败时不会阻塞其他 feed 的产物更新。
  if (runTweets) {
    console.error("Fetching X/Twitter content...");
    const xContent = await fetchXContent(
      sources.x_accounts,
      xBearerToken,
      state,
      errors,
    );
    console.error(`  Found ${xContent.length} builders with new tweets`);

    const totalTweets = xContent.reduce((sum, a) => sum + a.tweets.length, 0);
    const xFeed = {
      _comment:
        "中心生成的 X/Twitter feed。字段说明：generatedAt 为生成时间；lookbackHours 为抓取窗口；x 为按账号聚合的新帖；stats 为数量统计；errors 为非致命抓取问题。",
      generatedAt: new Date().toISOString(),
      lookbackHours: TWEET_LOOKBACK_HOURS,
      x: xContent,
      stats: { xBuilders: xContent.length, totalTweets },
      errors:
        errors.filter((e) => e.startsWith("X API")).length > 0
          ? errors.filter((e) => e.startsWith("X API"))
          : undefined,
    };
    await writeFile(
      join(SCRIPT_DIR, "..", "feed-x.json"),
      JSON.stringify(xFeed, null, 2),
    );
    console.error(
      `  feed-x.json: ${xContent.length} builders, ${totalTweets} tweets`,
    );
  }

  // Fetch podcasts
  if (runPodcasts) {
    console.error("Fetching podcast content (RSS + pod2txt)...");
    const podcasts = await fetchPodcastContent(
      sources.podcasts,
      pod2txtKey,
      state,
      errors,
    );
    console.error(`  Found ${podcasts.length} new episodes`);

    const podcastFeed = {
      _comment:
        "中心生成的播客 feed。字段说明：podcasts 保存已取得转录文本的新节目；transcript 供 LLM 摘要；errors 记录转录或 RSS 问题。",
      generatedAt: new Date().toISOString(),
      lookbackHours: PODCAST_LOOKBACK_HOURS,
      podcasts,
      stats: { podcastEpisodes: podcasts.length },
      errors:
        errors.filter((e) => e.startsWith("Podcast")).length > 0
          ? errors.filter((e) => e.startsWith("Podcast"))
          : undefined,
    };
    await writeFile(
      join(SCRIPT_DIR, "..", "feed-podcasts.json"),
      JSON.stringify(podcastFeed, null, 2),
    );
    console.error(`  feed-podcasts.json: ${podcasts.length} episodes`);
  }

  // Fetch blog posts
  if (runBlogs && sources.blogs && sources.blogs.length > 0) {
    console.error("Fetching blog content...");
    const blogContent = await fetchBlogContent(sources.blogs, state, errors);
    console.error(`  Found ${blogContent.length} new blog post(s)`);

    const blogFeed = {
      _comment:
        "中心生成的官方博客 feed。字段说明：blogs 保存新文章全文；content 供 LLM 判断技术和产品信号；errors 记录索引或正文抓取问题。",
      generatedAt: new Date().toISOString(),
      lookbackHours: BLOG_LOOKBACK_HOURS,
      blogs: blogContent,
      stats: { blogPosts: blogContent.length },
      errors:
        errors.filter((e) => e.startsWith("Blog")).length > 0
          ? errors.filter((e) => e.startsWith("Blog"))
          : undefined,
    };
    await writeFile(
      join(SCRIPT_DIR, "..", "feed-blogs.json"),
      JSON.stringify(blogFeed, null, 2),
    );
    console.error(`  feed-blogs.json: ${blogContent.length} posts`);
  }

  // Save dedup state
  // 抓取结束才统一保存，确保同一轮运行内的 tweet/episode/article 都被记录。
  await saveState(state);

  if (errors.length > 0) {
    console.error(`  ${errors.length} non-fatal errors`);
  }
}

main().catch((err) => {
  console.error("Feed generation failed:", err.message);
  process.exit(1);
});
