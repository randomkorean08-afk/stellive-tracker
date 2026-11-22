// View counts: collection helpers (collector) + Korean formatting and sorting (song search).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVideoStats, pickViewTargets, applyViewCounts, VIEW_REFRESH_HOURS } from "../lib/collector.mjs";
import { formatViews, sortSongs } from "../lib/song-search.mjs";

const NOW = "2026-11-22T00:00:00Z";

test("formatViews: Korean units", () => {
  assert.equal(formatViews(0), "0회");
  assert.equal(formatViews(999), "999회");
  assert.equal(formatViews(9999), "9,999회");
  assert.equal(formatViews(12345), "1.2만회");
  assert.equal(formatViews(10000), "1만회");
  assert.equal(formatViews(123456), "12만회");
  assert.equal(formatViews(16000000), "1,600만회");
  assert.equal(formatViews(123000000), "1.2억회");
  assert.equal(formatViews(null), null);
  assert.equal(formatViews(-1), null);
});

test("sortSongs: newest / views / score, missing values last", () => {
  const rows = [
    { videoId: "aaaaaaaaaaa", publishedAt: "2024-01-01", songScore: 90 },
    { videoId: "bbbbbbbbbbb", publishedAt: "2025-01-01", songScore: null },
    { videoId: "ccccccccccc", publishedAt: "2026-01-01", songScore: 95 },
  ];
  const views = { aaaaaaaaaaa: 5000, ccccccccccc: 100 };
  assert.deepEqual(sortSongs(rows, "newest").map((r) => r.videoId[0]), ["c", "b", "a"]);
  assert.deepEqual(sortSongs(rows, "views", views).map((r) => r.videoId[0]), ["a", "c", "b"]);
  assert.deepEqual(sortSongs(rows, "score").map((r) => r.videoId[0]), ["c", "a", "b"]);
  assert.equal(rows[0].videoId, "aaaaaaaaaaa", "input not mutated");
});

test("parseVideoStats: reads statistics.viewCount, skips hidden/invalid", () => {
  const j = { items: [
    { id: "R_B4tmy2DVA", statistics: { viewCount: "16000000" } },
    { id: "CyOAmEihVHs", statistics: {} },
    { id: "bad", statistics: { viewCount: "5" } },
  ] };
  assert.deepEqual(parseVideoStats(j), { R_B4tmy2DVA: 16000000 });
});

test("pickViewTargets: music only, not excluded/deleted, never-fetched first, 55-min refresh, limit, force", () => {
  const v = (id, cat, extra = {}) => ({ videoId: id, status: "active", auto: { category: cat }, ...extra });
  const videos = {
    m1aaaaaaaaa: v("m1aaaaaaaaa", "solo_cover"),
    m2aaaaaaaaa: v("m2aaaaaaaaa", "original", { viewCountAt: "2026-11-20T00:00:00Z", viewCount: 1 }),
    m3aaaaaaaaa: v("m3aaaaaaaaa", "live_special", { viewCountAt: "2026-11-21T23:30:00Z", viewCount: 1 }), // 30 min old: fresh
    n1aaaaaaaaa: v("n1aaaaaaaaa", "non_music"),
    d1aaaaaaaaa: v("d1aaaaaaaaa", "solo_cover", { status: "deleted" }),
    x1aaaaaaaaa: v("x1aaaaaaaaa", "solo_cover"),
    o1aaaaaaaaa: v("o1aaaaaaaaa", "non_music"),
  };
  const overrides = { x1aaaaaaaaa: { exclude: true }, o1aaaaaaaaa: { category: "original" } };
  assert.deepEqual(pickViewTargets(videos, { overrides, now: NOW }), ["m1aaaaaaaaa", "o1aaaaaaaaa", "m2aaaaaaaaa"]);
  assert.deepEqual(pickViewTargets(videos, { overrides, now: NOW, limit: 1 }), ["m1aaaaaaaaa"]);
  assert.deepEqual(pickViewTargets(videos, { overrides, now: NOW, refreshHours: 0 }), ["m1aaaaaaaaa", "o1aaaaaaaaa", "m2aaaaaaaaa", "m3aaaaaaaaa"], "force: all, no cooldown");
});

test("view refresh: hourly cooldown (45 min, tolerates cron jitter); group songs and 방송노래 included", () => {
  assert.equal(VIEW_REFRESH_HOURS, 45 / 60);
  const at = (min) => new Date(Date.parse(NOW) - min * 60e3).toISOString();
  const v = (id, cat, min, members = ["a"], extra = {}) => ({ videoId: id, status: "active", auto: { category: cat, members, ...extra }, viewCount: 1, viewCountAt: at(min) });
  const videos = {
    g: v("g", "original", 60, ["a", "b", "c"]), // 단체곡
    s: v("s", "stream_song", 50),               // 방송노래, previous run started 10 min late -> still due
    f: v("f", "solo_cover", 40),                // fetched 40 min ago -> not due
    r: v("r", "stream_song", 90, ["a"], { reviewRequired: true }), // unreviewed candidate -> not refreshed
  };
  assert.deepEqual(pickViewTargets(videos, { now: NOW }).sort(), ["g", "s"]);
  assert.deepEqual(pickViewTargets(videos, { now: NOW, overrides: { r: { reviewed: true } } }).sort(), ["g", "r", "s"], "approved -> refreshed");
});

test("applyViewCounts: sets viewCount + viewCountAt, leaves others untouched", () => {
  const videos = { a: { videoId: "a", title: "x" }, b: { videoId: "b", title: "y" } };
  const out = applyViewCounts(videos, { a: 42, zz: 1 }, NOW);
  assert.deepEqual(out.a, { videoId: "a", title: "x", viewCount: 42, viewCountAt: NOW });
  assert.equal(out.b, videos.b);
  assert.ok(!("zz" in out));
  assert.ok(!("viewCount" in videos.a), "input not mutated");
});
