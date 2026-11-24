#!/usr/bin/env node
// Collector entry point. The ONLY file this script writes is data/videos.json.
// (ratings / overrides / channels-lock / baseline / docs / fixtures are read-only for the bot.)
//
// Usage: node scripts/fetch-videos.mjs [--dry-run] [--no-status] [--status-limit N]
//        [--recheck-hours N] [--longform-feed] [--backfill] [--no-views] [--views-limit N] [--force-views] [--no-shorts-check] [--shorts-limit N] [--reclassify-all]
// Playlists (after the official channels): the member playlists in data/playlists.json are synced as 방송노래.
// With YOUTUBE_API_KEY: playlists.list (1 unit per 50 ids: itemCount + title for the coverage log), then playlistItems.list
// for every playlist (50 items/page, 1 quota unit per page, all pages every run; ~2-3 pages per playlist).
// Without a key (or when the API call fails): the playlist RSS feed (newest ~15 items).
// Coverage: one "coverage <id> (<member>): collected N / total M" line per playlist; gaps are WARN, unknown ids ERROR.
// Videos already in videos.json are never touched; new fan uploads become 방송노래, new official-channel uploads are
// classified like any official upload. A failing playlist logs one "ERROR playlist ..." line; the others continue.
// Existing videos keep their stored classification; only new/renamed videos are classified (use --reclassify-all after rule changes).
// Status checks: music videos only; deleted/private are final.
// Shorts: music/unknown videos are checked once via youtube.com/shorts/<id> (200 = Shorts) and excluded.
// View counts: with YOUTUBE_API_KEY set, every listed song video's statistics.viewCount is refreshed when >= 55 min old
// (hourly schedule); --force-views refreshes all immediately.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  parseAtomFeed, mergeEntries, applyStatusAndAuthor, pickStatusTargets, checkOembed, httpGet,
  parseVideoStats, pickViewTargets, applyViewCounts, redactKey, checkShortFormat, pickShortTargets, applyShortFormat,
  validatePlaylists, collectPlaylists, mergePlaylistEntries, formatCoverageLine,
  videosEqual, serializeVideosDoc,
}from "../lib/collector.mjs";
import { normalizeVideoId } from "../lib/video-id.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIDEOS_PATH = path.join(ROOT, "data", "videos.json");
const LOCK_PATH = path.join(ROOT, "data", "channels-lock.json");
const OVERRIDES_PATH = path.join(ROOT, "data", "overrides.json"); // read-only (view-count targeting)
const PLAYLISTS_PATH = path.join(ROOT, "data", "playlists.json"); // read-only: member playlists (user-owned)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DELAY_MS = 400;

function parseArgs(argv) {
  const o = { dryRun: false, status: true, statusLimit: 60, recheckHours: 24, longform: false, backfill: false, views: true, viewsLimit: 1000, forceViews: false, shorts: true, shortsLimit: 500, reclassifyAll: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--no-status") o.status = false;
    else if (a === "--longform-feed") o.longform = true;
    else if (a === "--backfill") o.backfill = true;
    else if (a === "--no-views") o.views = false;
    else if (a === "--force-views") o.forceViews = true;
    else if (a === "--no-shorts-check") o.shorts = false;
    else if (a === "--reclassify-all") o.reclassifyAll = true;
    else if (a === "--shorts-limit") o.shortsLimit = Number(argv[++i]);
    else if (a === "--views-limit") o.viewsLimit = Number(argv[++i]);
    else if (a.startsWith("--views-limit=")) o.viewsLimit = Number(a.split("=")[1]);
    else if (a === "--status-limit") o.statusLimit = Number(argv[++i]);
    else if (a.startsWith("--status-limit=")) o.statusLimit = Number(a.split("=")[1]);
    else if (a === "--recheck-hours") o.recheckHours = Number(argv[++i]);
    else if (a.startsWith("--recheck-hours=")) o.recheckHours = Number(a.split("=")[1]);
    else console.warn(`[warn] unknown option ignored: ${a}`);
  }
  if (!Number.isFinite(o.statusLimit) || o.statusLimit < 0) o.statusLimit = 60;
  if (!Number.isFinite(o.recheckHours) || o.recheckHours < 0) o.recheckHours = 24;
  return o;
}

async function readJson(p) {
  return JSON.parse((await readFile(p, "utf8")).replace(/^﻿/, ""));
}

async function fetchFeed(channel, longform) {
  const urls = [];
  if (longform) urls.push(`https://www.youtube.com/feeds/videos.xml?playlist_id=UULF${channel.channelId.slice(2)}`);
  urls.push(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`);
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await httpGet(url);
      if (res.status === 200) return parseAtomFeed(await res.text());
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = String(e?.message ?? e);
    }
    await sleep(DELAY_MS);
  }
  throw new Error(lastErr ?? "feed fetch failed");
}

async function fetchBackfill(channel, apiKey, longform = false) {
  // UULF = long-form uploads only (no Shorts); UU = every upload
  const playlist = `${longform ? "UULF" : "UU"}${channel.channelId.slice(2)}`;
  const out = [];
  let pageToken = "";
  for (let page = 0; page < 200; page++) {
    const url =
      "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50" +
      `&playlistId=${playlist}&key=${encodeURIComponent(apiKey)}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const res = await httpGet(url);
    if (res.status !== 200) throw new Error(`playlistItems HTTP ${res.status}`); // never print the URL (contains key)
    const j = await res.json();
    for (const it of j.items ?? []) {
      const id = normalizeVideoId(it.contentDetails?.videoId ?? "");
      const title = it.snippet?.title ?? "";
      if (!id || title === "Private video" || title === "Deleted video") continue;
      out.push({ videoId: id, title, publishedAt: it.contentDetails?.videoPublishedAt ?? it.snippet?.publishedAt ?? null });
    }
    pageToken = j.nextPageToken ?? "";
    if (!pageToken) break;
    await sleep(DELAY_MS);
  }
  return out;
}

/** videos.list?part=statistics in batches of 50 (1 quota unit per call). Never prints the URL (contains key). */
async function fetchViewCounts(ids, apiKey) {
  const stats = {};
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = "https://www.googleapis.com/youtube/v3/videos?part=statistics&maxResults=50" +
      `&id=${batch.map(encodeURIComponent).join(",")}&key=${encodeURIComponent(apiKey)}`;
    const res = await httpGet(url);
    if (res.status !== 200) throw new Error(`videos.list HTTP ${res.status}`);
    Object.assign(stats, parseVideoStats(await res.json()));
    await sleep(DELAY_MS);
  }
  return stats;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const lock = await readJson(LOCK_PATH);
  const prevDoc = await readJson(VIDEOS_PATH);
  const prevVideos = prevDoc.videos ?? {};
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  // collect: "none" 채널(예: 자동 생성 Topic 채널)은 승인 여부와 무관하게 자동 수집하지 않는다.
  const isCollectable = (c) => c.verified === true && !!c.channelId && c.collect !== "none";
  const collectable = (lock.channels ?? []).filter(isCollectable);
  const skipped = (lock.channels ?? []).filter((c) => !isCollectable(c)).map((c) => (c.collect === "none" ? `${c.key}(collect:none)` : c.key));

  // ---- 1) collect feeds ----
  const incoming = [];
  const feedErrors = [];
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (opts.backfill && !apiKey) console.warn("[warn] --backfill requested but YOUTUBE_API_KEY is not set; skipping backfill.");
  for (const ch of collectable) {
    try {
      const entries = await fetchFeed(ch, opts.longform);
      for (const e of entries) incoming.push({ ...e, channelKey: ch.key, source: "rss" });
    } catch (e) {
      feedErrors.push(`${ch.key}: ${e.message}`);
    }
    await sleep(DELAY_MS);
    if (opts.backfill && apiKey) {
      try {
        const entries = await fetchBackfill(ch, apiKey, opts.longform);
        for (const e of entries) incoming.push({ ...e, channelKey: ch.key, source: "backfill" });
      } catch (e) {
        feedErrors.push(`${ch.key} (backfill): ${redactKey(e.message, apiKey)}`);
      }
    }
  }

  // ---- 1b) member playlists (방송노래) ----
  let playlistCfg = { playlists: [] };
  try { playlistCfg = await readJson(PLAYLISTS_PATH); } catch (e) { console.warn(`[warn] data/playlists.json not readable (${e.code ?? e.message}); playlists skipped.`); }
  const plCheck = validatePlaylists(playlistCfg, lock);
  for (const msg of plCheck.errors) console.log(`ERROR playlist ${msg}`);
  const plResult = await collectPlaylists(plCheck.valid, { apiKey, sleepMs: DELAY_MS, log: (s) => console.log(s) });

  // ---- 2) merge (+ reclassify with current rules); playlists last so they never override an official-channel entry ----
  const merged = mergeEntries(prevVideos, incoming, lock, now, { reclassifyAll: opts.reclassifyAll, playlists: playlistCfg });
  const plMerged = mergePlaylistEntries(merged.videos, plResult.incoming, lock, now);
  let videos = plMerged.videos;

  // ---- 3) status checks ----
  const statusChanges = [];
  const statusLog = [];
  if (opts.status && opts.statusLimit > 0) {
    const statusOverrides = (await readJson(OVERRIDES_PATH).catch(() => ({}))).videos ?? {};
    const targets = pickStatusTargets(videos, { limit: opts.statusLimit, now, recheckHours: opts.recheckHours, overrides: statusOverrides });
    for (const id of targets) {
      const res = await checkOembed(id);
      const before = videos[id];
      const after = applyStatusAndAuthor(before, res, lock, now);
      videos[id] = after;
      statusLog.push({ id, code: res.code ?? `ERR(${res.error})`, authorName: res.authorName ?? "", filledChannel: !before.channelKey && !!after.channelKey ? after.channelKey : null });
      if (before.status !== after.status) statusChanges.push(`${id}: ${before.status} -> ${after.status}`);
      await sleep(DELAY_MS);
    }
  }

  // ---- 3a) Shorts format check (music/unknown only, once per video) ----
  let shortsFound = 0, shortsChecked = 0;
  let overridesForChecks = {};
  try { overridesForChecks = (await readJson(OVERRIDES_PATH)).videos ?? {}; } catch { /* optional */ }
  if (opts.shorts && opts.shortsLimit > 0) {
    for (const id of pickShortTargets(videos, { overrides: overridesForChecks, limit: opts.shortsLimit })) {
      const r = await checkShortFormat(id);
      if (r !== null) { shortsChecked++; if (r) shortsFound++; videos[id] = applyShortFormat(videos[id], r, lock); }
      await sleep(DELAY_MS);
    }
  }

  // ---- 3b) view counts (needs YOUTUBE_API_KEY; music videos only, max once per 24h) ----
  let viewsUpdated = 0;
  if (opts.views && apiKey && opts.viewsLimit > 0) {
    let overridesVideos = {};
    try { overridesVideos = (await readJson(OVERRIDES_PATH)).videos ?? {}; } catch { /* read-only, optional */ }
    const targets = pickViewTargets(videos, { overrides: overridesVideos, now, limit: opts.viewsLimit, ...(opts.forceViews ? { refreshHours: 0 } : {}) });
    try {
      const stats = await fetchViewCounts(targets, apiKey);
      videos = applyViewCounts(videos, stats, now);
      viewsUpdated = Object.keys(stats).length;
    } catch (e) {
      feedErrors.push(`view counts: ${redactKey(e.message, apiKey)}`);
    }
  } else if (opts.views && !apiKey) console.log("view counts: skipped (YOUTUBE_API_KEY not set)");

  // ---- 4) write only when something actually changed ----
  const changed = !videosEqual(prevVideos, videos);
  const text = serializeVideosDoc(prevDoc, videos, { now, changed });

  // ---- summary ----
  const perChannel = {};
  for (const e of incoming) perChannel[e.channelKey] ??= { added: new Set(), updated: new Set() };
  for (const e of incoming) {
    if (merged.added.includes(e.videoId)) perChannel[e.channelKey].added.add(e.videoId);
    else if (merged.updated.includes(e.videoId)) perChannel[e.channelKey].updated.add(e.videoId);
  }
  console.log(`== fetch-videos ${opts.dryRun ? "(dry-run) " : ""}${now} ==`);
  console.log(`channels collected: ${collectable.length}, feed entries: ${incoming.length}`);
  for (const [k, v] of Object.entries(perChannel)) console.log(`  ${k}: new ${v.added.size}, updated ${v.updated.size}`);
  console.log(`new: ${merged.added.length}, updated(existing): ${merged.updated.length}, total videos: ${Object.keys(videos).length}`);
  console.log(`playlists: ${plResult.ok}/${plCheck.valid.length} ok, ${plResult.incoming.length} items seen, new from playlists: ${plMerged.added.length}` +
    (apiKey ? `, API quota spent: ${plResult.pages + plResult.metaCalls} unit(s) (playlists.list ${plResult.metaCalls} + playlistItems ${plResult.pages})` : " (RSS fallback, no API key)"));
  for (const row of plResult.coverage) {
    const ids = new Set(plResult.incoming.filter((e) => e.playlistId === row.playlistId).map((e) => e.videoId));
    console.log(formatCoverageLine(row, [...ids].filter((id) => id in videos).length));
  }
  const plFailed = plResult.errors.length + plCheck.errors.length;
  if (plFailed) console.log(`playlist errors: ${plFailed} (see ERROR lines above)`);
  if (shortsChecked) console.log(`shorts check: ${shortsChecked} checked, ${shortsFound} are Shorts (excluded)`);
  if (viewsUpdated) console.log(`view counts updated: ${viewsUpdated}`);
  const reviewNew = [...merged.added, ...plMerged.added].filter((id) => videos[id].auto.reviewRequired).length;
  console.log(`new needing review: ${reviewNew}`);
  if (statusLog.length) {
    console.log(`oEmbed checked: ${statusLog.length}`);
    for (const s of statusLog) console.log(`  ${s.id}  ${s.code}  ${s.authorName}${s.filledChannel ? `  [channelKey -> ${s.filledChannel}]` : ""}`);
  }
  console.log(`status changes: ${statusChanges.length ? "\n  " + statusChanges.join("\n  ") : "none"}`);
  if (feedErrors.length) console.log(`feed errors:\n  ${feedErrors.join("\n  ")}`);
  console.log(`skipped (unverified or no channelId): ${skipped.length ? skipped.join(", ") : "none"}`);
  console.log(`data/videos.json changed: ${changed}`);

  if (opts.dryRun) {
    console.log("dry-run: no files written.");
  } else if (changed) {
    await writeFile(VIDEOS_PATH, text, "utf8");
    console.log("wrote data/videos.json");
  } else {
    console.log("no changes; file untouched.");
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
