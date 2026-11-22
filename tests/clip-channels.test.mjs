// Clipper channels (data/clip-channels.json) and daily keyword search -> 방송노래.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { clipAuto, reclassify, mergeEntries } from "../lib/collector.mjs";
import { readJson, ROOT } from "./load.mjs";

const lock = readJson("data/channels-lock.json");
const NOW = "2026-11-22T00:00:00Z";
const e = (title, extra = {}) => ({ videoId: "ZZZZZZZZZZZ", title, publishedAt: "2026-11-20", channelKey: null, clipChannel: "UCxxxxxxxxxxxxxxxxxxxxxx", ...extra });

test("clip channel: song clip without our keywords -> stream_song with members from the title", () => {
  const a = clipAuto(e("아카네 리제 - 만찬가 (晩餐歌)"), lock);
  assert.equal(a.category, "stream_song");
  assert.deepEqual(a.members, ["akane-lize"]);
  assert.equal(a.reviewRequired, false);
  assert.deepEqual(a.matchedRules, ["C01-clip-channel"]);
});

test("clip channel: no member in the title -> review; Shorts / full stream VOD keep their exclusion", () => {
  const a = clipAuto(e("만찬가 (晩餐歌)"), lock);
  assert.equal(a.category, "stream_song");
  assert.equal(a.reviewRequired, true);
  assert.ok(a.reviewReasons.includes("no_member_detected"));
  assert.equal(clipAuto(e("리제 만찬가", { isShort: true }), lock).category, "excluded_short");
  assert.equal(clipAuto(e("리제 노래방송 다시보기"), lock).category, "excluded_stream");
});

test("search result -> 방송노래 candidate that always waits for review", () => {
  const a = clipAuto(e("아카네 리제 만찬가", { clipChannel: undefined, searchQuery: "스텔라이브 노래" }), lock);
  assert.equal(a.category, "stream_song");
  assert.equal(a.reviewRequired, true);
  assert.ok(a.reviewReasons.includes("search_candidate"));
  assert.deepEqual(a.matchedRules, ["C02-search-clip"]);
});

test("merge keeps clipChannel/searchQuery on new entries and reclassify uses clip rules", () => {
  const m = mergeEntries({}, [{ videoId: "ZZZZZZZZZZZ", title: "아카네 리제 - 만찬가", channelKey: null, clipChannel: "UCxxxxxxxxxxxxxxxxxxxxxx", source: "clip-channel" }], lock, NOW);
  const v = m.videos.ZZZZZZZZZZZ;
  assert.equal(v.clipChannel, "UCxxxxxxxxxxxxxxxxxxxxxx");
  assert.equal(v.auto.category, "stream_song");
  assert.equal(reclassify(v, lock).auto.category, "stream_song");
});

test("clip-channels.json is valid, user-owned, and only read by the script", () => {
  const cfg = readJson("data/clip-channels.json");
  assert.equal(cfg.schemaVersion, 1);
  assert.ok(Array.isArray(cfg.channels) && Array.isArray(cfg.searchQueries));
  for (const c of cfg.channels) assert.match(c.channelId, /^UC[\w-]{22}$/);
  const src = readFileSync(path.join(ROOT, "scripts", "fetch-videos.mjs"), "utf8");
  assert.match(src, /readJson\(CLIP_CHANNELS_PATH\)/);
  assert.match(src, /--search-clips/);
});
