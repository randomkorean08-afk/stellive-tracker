// Collector core logic (script-side; pure functions + small fetch helpers with injectable fetch).
// Write boundary: this module never touches the filesystem. Only scripts/fetch-videos.mjs writes
// data/videos.json. Contract: docs/schema.md sections 1, 2, 8.

import { normalizeVideoId } from "./video-id.mjs";
import { classify } from "./classify.mjs";

export const UA = "stellive-vocal-tracker/1.0 (+RSS and oEmbed status checker)";
const ENTRY_KEY_ORDER = [
  "videoId", "title", "previousTitles", "channelKey", "seenOnChannels", "publishedAt", "source",
  "firstSeenAt", "lastSeenInFeedAt", "status", "statusCheckedAt", "failStreak", "viewCount", "viewCountAt", "auto",
];
const AUTO_KEY_ORDER = ["category", "members", "matchedRules", "reviewRequired", "reviewReasons"];

// ---------------------------------------------------------------- Atom parsing

export function decodeEntities(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, g) => {
      if (g[0] === "#") {
        const cp = g[1] === "x" || g[1] === "X" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
        try { return String.fromCodePoint(cp); } catch { return m; }
      }
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[g];
    });
}

/** Dependency-free Atom parser for YouTube feeds. Entries with an invalid ID are dropped. */
export function parseAtomFeed(xml) {
  const out = [];
  const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(String(xml))) !== null) {
    const body = m[1];
    const idRaw = /<yt:videoId>([\s\S]*?)<\/yt:videoId>/.exec(body)?.[1];
    const videoId = normalizeVideoId(decodeEntities(idRaw ?? "").trim());
    if (!videoId) continue;
    const title = /<title\b[^>]*>([\s\S]*?)<\/title>/.exec(body)?.[1];
    const published = /<published>([\s\S]*?)<\/published>/.exec(body)?.[1];
    out.push({
      videoId,
      title: decodeEntities(title ?? "").trim(),
      publishedAt: published ? decodeEntities(published).trim() : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------- merge

const uniq = (a) => [...new Set(a)];
const dayOf = (iso) => (typeof iso === "string" ? iso.slice(0, 10) : null);

export function reclassify(entry, lock) {
  const r = classify({ title: entry.title, channelKey: entry.channelKey ?? null, publishedAt: entry.publishedAt }, lock);
  return { ...entry, auto: r };
}

function fingerprint(e) {
  // fields whose change counts as "updated" (lastSeenInFeedAt is bookkeeping only)
  return JSON.stringify([e.title, e.previousTitles, e.channelKey, e.seenOnChannels, e.publishedAt, e.auto]);
}

/**
 * Merge feed entries into an ID-keyed object. Never deletes. Never touches ratings.
 * @param {Record<string,object>} existing
 * @param {{videoId:string,title:string,channelKey?:string|null,publishedAt?:string|null,source?:string}[]} incoming
 * @returns {{videos:Record<string,object>, added:string[], updated:string[]}}
 */
export function mergeEntries(existing, incoming, lock, now) {
  const videos = {};
  for (const [id, v] of Object.entries(existing ?? {})) videos[id] = reclassify(structuredClone(v), lock);
  const added = [];

  for (const inc of incoming ?? []) {
    const id = normalizeVideoId(inc.videoId);
    if (!id) continue;
    const ch = inc.channelKey ?? null;
    const cur = videos[id];
    if (!cur) {
      videos[id] = reclassify(
        {
          videoId: id,
          title: inc.title ?? "",
          previousTitles: [],
          channelKey: ch,
          seenOnChannels: ch ? [ch] : [],
          publishedAt: inc.publishedAt ?? null,
          source: inc.source ?? "rss",
          firstSeenAt: now,
          lastSeenInFeedAt: inc.source === "backfill" ? null : now,
          status: "unverified",
          statusCheckedAt: null,
          failStreak: 0,
        },
        lock,
      );
      added.push(id);
      continue;
    }
    let next = { ...cur };
    if (inc.title && inc.title !== cur.title) {
      next.previousTitles = uniq([...(cur.previousTitles ?? []), cur.title]);
      next.title = inc.title;
    }
    if (ch) next.seenOnChannels = uniq([...(cur.seenOnChannels ?? []), ch]);
    if (!cur.channelKey && ch) next.channelKey = ch;
    if (inc.source !== "backfill" && dayOf(cur.lastSeenInFeedAt) !== dayOf(now)) next.lastSeenInFeedAt = now;
    videos[id] = reclassify(next, lock);
  }

  const updated = [];
  for (const id of Object.keys(existing ?? {})) {
    if (!(id in videos)) continue;
    if (fingerprint(videos[id]) !== fingerprint(existing[id])) updated.push(id);
  }
  return { videos, added, updated };
}

// ---------------------------------------------------------------- status check

/**
 * result: {code:number} | {error:string}. 200 -> active; 404 -> deleted after 2; 401/403 -> private after 2;
 * anything else (network, 5xx, 429...) -> no change at all.
 */
export function applyStatusResult(entry, result, now) {
  const code = result?.code;
  if (code === 200) return { ...entry, status: "active", failStreak: 0, statusCheckedAt: now };
  if (code === 404 || code === 401 || code === 403) {
    const failStreak = (entry.failStreak ?? 0) + 1;
    const next = { ...entry, failStreak, statusCheckedAt: now };
    if (failStreak >= 2) next.status = code === 404 ? "deleted" : "private";
    return next;
  }
  return entry;
}

/** Oldest statusCheckedAt first (null first). Healthy entries checked within recheckHours are skipped. */
export function pickStatusTargets(videos, { limit = 60, now, recheckHours = 24 } = {}) {
  const nowMs = Date.parse(now);
  const cutoff = nowMs - recheckHours * 3600 * 1000;
  return Object.values(videos)
    .filter((v) => {
      if (!v.statusCheckedAt) return true;
      const pending = (v.failStreak ?? 0) > 0 && v.status !== "deleted" && v.status !== "private";
      return pending || Date.parse(v.statusCheckedAt) <= cutoff;
    })
    .sort((a, b) => {
      const ta = a.statusCheckedAt ? Date.parse(a.statusCheckedAt) : -Infinity;
      const tb = b.statusCheckedAt ? Date.parse(b.statusCheckedAt) : -Infinity;
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.videoId < b.videoId ? -1 : 1;
    })
    .slice(0, limit)
    .map((v) => v.videoId);
}

/** Map an oEmbed author_url (handle or /channel/UC... form) to a locked channel key. */
export function channelKeyFromAuthorUrl(authorUrl, lock) {
  if (typeof authorUrl !== "string") return null;
  let path;
  try { path = decodeURIComponent(new URL(authorUrl).pathname); } catch { return null; }
  const seg = path.split("/").filter(Boolean);
  for (const c of lock?.channels ?? []) {
    if (c.handle) {
      const h = String(c.handle).replace(/^@/, "").toLowerCase();
      if (seg[0] && seg[0].startsWith("@") && seg[0].slice(1).toLowerCase() === h) return c.key;
    }
    if (c.channelId && seg[0] === "channel" && seg[1] === c.channelId) return c.key;
  }
  return null;
}

/** Apply a status result and, on a 200 with a known author, fill a null channelKey. */
export function applyStatusAndAuthor(entry, result, lock, now) {
  let next = applyStatusResult(entry, result, now);
  if (result?.code === 200 && !next.channelKey) {
    const key = channelKeyFromAuthorUrl(result.authorUrl, lock);
    if (key) next = reclassify({ ...next, channelKey: key, seenOnChannels: uniq([...(next.seenOnChannels ?? []), key]) }, lock);
  }
  return next;
}

// ---------------------------------------------------------------- network helpers

export async function httpGet(url, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  return fetchImpl(url, {
    headers: { "User-Agent": UA, Accept: "*/*" },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
}

/** @returns {Promise<{code:number, authorName?:string, authorUrl?:string}|{error:string}>} */
export async function checkOembed(videoId, opts = {}) {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  try {
    const res = await httpGet(url, opts);
    if (res.status === 200) {
      let j = {};
      try { j = await res.json(); } catch { /* ignore body problems */ }
      return { code: 200, authorName: j.author_name, authorUrl: j.author_url };
    }
    return { code: res.status };
  } catch (e) {
    return { error: String(e?.message ?? e) };
  }
}

// ---------------------------------------------------------------- view counts (YouTube Data API videos.list)

const VIEW_MUSIC = new Set(["solo_cover", "collab_cover", "live_special", "original"]);

/** Parse a videos.list?part=statistics response -> { videoId: number }. Hidden/missing counts are skipped. */
export function parseVideoStats(json) {
  const out = {};
  for (const it of json?.items ?? []) {
    const id = normalizeVideoId(it?.id ?? "");
    const n = Number(it?.statistics?.viewCount);
    if (id && Number.isFinite(n) && n >= 0) out[id] = n;
  }
  return out;
}

/**
 * Music videos whose view count is missing or older than refreshHours, never-fetched first then oldest.
 * Category = override category if present, else auto. Deleted/private videos are skipped.
 */
export function pickViewTargets(videos, { overrides = {}, now, refreshHours = 24, limit = 1000 } = {}) {
  const cut = Date.parse(now) - refreshHours * 3600e3;
  return Object.values(videos ?? {})
    .filter((v) => VIEW_MUSIC.has(overrides?.[v.videoId]?.category ?? v.auto?.category))
    .filter((v) => overrides?.[v.videoId]?.exclude !== true && v.status !== "deleted" && v.status !== "private")
    .filter((v) => !v.viewCountAt || Date.parse(v.viewCountAt) <= cut)
    .sort((a, b) => (a.viewCountAt ? Date.parse(a.viewCountAt) : 0) - (b.viewCountAt ? Date.parse(b.viewCountAt) : 0) || (a.videoId < b.videoId ? -1 : 1))
    .slice(0, limit)
    .map((v) => v.videoId);
}

/** Return a new videos map with viewCount/viewCountAt set for ids present in stats. */
export function applyViewCounts(videos, stats, now) {
  const out = { ...videos };
  for (const [id, n] of Object.entries(stats ?? {})) if (out[id]) out[id] = { ...out[id], viewCount: n, viewCountAt: now };
  return out;
}

// ---------------------------------------------------------------- serialization

function canonicalEntry(e) {
  const out = {};
  for (const k of ENTRY_KEY_ORDER) {
    if (!(k in e)) continue;
    if (k === "auto" && e.auto) {
      const a = {};
      for (const ak of AUTO_KEY_ORDER) if (ak in e.auto) a[ak] = e.auto[ak];
      for (const ak of Object.keys(e.auto)) if (!(ak in a)) a[ak] = e.auto[ak];
      out.auto = a;
    } else out[k] = e[k];
  }
  for (const k of Object.keys(e)) if (!(k in out)) out[k] = e[k];
  return out;
}

export function sortedVideoIds(videos) {
  const ts = (v) => {
    const t = Date.parse(v.publishedAt ?? "");
    return Number.isNaN(t) ? -Infinity : t;
  };
  return Object.keys(videos).sort((a, b) => {
    const ta = ts(videos[a]);
    const tb = ts(videos[b]);
    if (ta !== tb) return ta < tb ? 1 : -1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/** Semantic equality of the videos maps (key order and formatting ignored). */
export function videosEqual(a, b) {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  if (ka.length !== kb.length) return false;
  return ka.every((k) => k in b && JSON.stringify(canonicalEntry(a[k])) === JSON.stringify(canonicalEntry(b[k])));
}

/**
 * Build the file text. Preserves other top-level keys (e.g. _note) in their original order.
 * updatedAt is refreshed only when `changed` is true.
 */
export function serializeVideosDoc(prevDoc, videos, { now, changed }) {
  const prev = prevDoc ?? { schemaVersion: 1 };
  const doc = {};
  for (const k of Object.keys(prev)) doc[k] = prev[k];
  if (!("schemaVersion" in doc)) doc.schemaVersion = 1;
  if (changed || !("updatedAt" in doc)) doc.updatedAt = changed ? now : prev.updatedAt ?? now;
  const sorted = {};
  for (const id of sortedVideoIds(videos)) sorted[id] = canonicalEntry(videos[id]);
  doc.videos = sorted;
  return JSON.stringify(doc, null, 2) + "\n";
}
