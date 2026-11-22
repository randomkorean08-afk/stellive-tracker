#!/usr/bin/env node
// Add a stream-song clip (방송노래) from ANY YouTube channel (e.g. a clipper's legendary singing cut).
//
// Usage:
//   node scripts/add-clip.mjs <youtube-url | video-id> --members <key|이름>[,<key|이름>...] [--song "곡명"] [--note "메모"] [--dry-run]
// Examples:
//   node scripts/add-clip.mjs https://youtu.be/XXXXXXXXXXX --members 아카네 리제 --song "발묘"
//   node scripts/add-clip.mjs XXXXXXXXXXX --members akane-lize,shirayuki-hina
//
// - Title / uploader come from YouTube oEmbed (no key). With YOUTUBE_API_KEY set, upload date and view count
//   are fetched too (videos.list, 1 quota unit); otherwise the next scheduled collection fills view counts.
// - The clip is stored in data/videos.json with source "manual", category stream_song (방송노래) and the given
//   members. It is never re-classified, is listed in the archive, and is never vocally evaluated.
// - YouTube Shorts are refused (Shorts are excluded everywhere). Videos already in videos.json are not touched
//   (change those with data/overrides.json instead).
// Write boundary: this script only writes data/videos.json.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildManualClip, serializeVideosDoc, checkShortFormat, httpGet, parseVideoStats } from "../lib/collector.mjs";
import { normalizeVideoId } from "../lib/video-id.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIDEOS_PATH = path.join(ROOT, "data", "videos.json");
const LOCK_PATH = path.join(ROOT, "data", "channels-lock.json");

const readJson = async (p) => JSON.parse((await readFile(p, "utf8")).replace(/^﻿/, ""));
const fail = (msg) => { console.error(`error: ${msg}`); process.exit(1); };

export function parseArgs(argv) {
  const o = { target: null, members: [], song: null, note: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--members") {
      // allow "아카네 리제" (space) as well as "akane-lize,shirayuki-hina": consume until the next --flag
      const parts = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) parts.push(argv[++i]);
      o.members = parts.join(" ").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--song") o.song = argv[++i] ?? null;
    else if (a === "--note") o.note = argv[++i] ?? null;
    else if (a === "--dry-run") o.dryRun = true;
    else if (!o.target) o.target = a;
  }
  return o;
}

/** Resolve member keys or Korean display names / aliases against channels-lock (members only). */
export function resolveMembers(names, lock) {
  const members = (lock.channels ?? []).filter((c) => c.type === "member");
  return names.map((n) => {
    const q = n.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
    const hit = members.find((c) => [c.key, c.displayName, ...(c.aliases ?? [])].some((x) => String(x).normalize("NFKC").toLowerCase().replace(/\s+/g, "") === q));
    if (!hit) throw new Error(`unknown member "${n}" (use a key like akane-lize or a name like 아카네 리제)`);
    return hit.key;
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const id = normalizeVideoId(opts.target ?? "");
  if (!id) fail("give a YouTube URL or 11-character video id");
  if (!opts.members.length) fail("--members is required");
  const lock = await readJson(LOCK_PATH);
  let members;
  try { members = [...new Set(resolveMembers(opts.members, lock))]; } catch (e) { fail(e.message); }

  const prevDoc = await readJson(VIDEOS_PATH);
  const videos = { ...(prevDoc.videos ?? {}) };
  if (videos[id]) fail(`${id} is already in videos.json (category ${videos[id].auto?.category}). Use data/overrides.json to change it.`);

  const oe = await httpGet(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`);
  if (oe.status !== 200) fail(`oEmbed HTTP ${oe.status} — video missing, private, or embedding disabled`);
  const meta = await oe.json();
  const isShort = await checkShortFormat(id);
  if (isShort === true) fail(`${id} is a YouTube Short; Shorts are excluded from the archive`);

  let publishedAt = null;
  let views = null;
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (apiKey) {
    const res = await httpGet(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${id}&key=${encodeURIComponent(apiKey)}`);
    if (res.status === 200) {
      const j = await res.json();
      publishedAt = j.items?.[0]?.snippet?.publishedAt ?? null;
      views = parseVideoStats(j)[id] ?? null;
    } else console.warn(`[warn] videos.list HTTP ${res.status}; date/views left empty`); // never print the URL (contains key)
  }

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const entry = buildManualClip({ videoId: id, title: meta.title, members, song: opts.song, authorName: meta.author_name ?? null, authorUrl: meta.author_url ?? null, publishedAt, note: opts.note }, now);
  if (isShort === false) entry.isShort = false;
  if (views !== null) { entry.viewCount = views; entry.viewCountAt = now; }
  videos[id] = entry;

  console.log(`방송노래 추가: ${id}\n  제목: ${entry.title}\n  업로더: ${entry.manual.uploader ?? "-"}\n  멤버: ${members.join(", ")}${opts.song ? `\n  곡: ${opts.song}` : ""}${views !== null ? `\n  조회수: ${views}` : ""}`);
  if (opts.dryRun) { console.log("dry-run: no files written."); return; }
  await writeFile(VIDEOS_PATH, serializeVideosDoc(prevDoc, videos, { now, changed: true }));
  console.log("wrote data/videos.json — commit and push to publish.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => fail(e.message));
