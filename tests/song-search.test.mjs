import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveAll } from "../lib/derive.mjs";
import { normalizeQuery, filterSongs, formatDateOnly } from "../lib/song-search.mjs";
import { readJson, deepFreeze, clone } from "./load.mjs";

const FIXTURE_ROWS = deepFreeze([
  {
    videoId: "vid_solo_new",
    title: "괴수의 꽃노래 (怪獣の花唄) / 아이리 칸나 Cover",
    publishedAt: "2026-11-10T10:00:00+00:00",
    category: "solo_cover",
    members: ["airi-kanna"],
    excluded: false,
    needsReview: false,
    counted: true,
    songScore: 95.5,
  },
  {
    videoId: "vid_collab",
    title: "타상연화『打上花火』[DAOKO × 요네즈켄시] | 시라유키 히나 x 아오쿠모 린 Cover",
    publishedAt: "2026-11-12",
    category: "collab_cover",
    members: ["shirayuki-hina", "aokumo-rin"],
    excluded: false,
    needsReview: false,
    counted: true,
    songScore: null,
  },
  {
    videoId: "vid_orig",
    title: "스텔라이브 (StelLive) | 'STAR TRAIL' Official MV",
    publishedAt: "2025-12-01",
    category: "original",
    members: ["ayatsuno-yuni", "akane-lize", "shirayuki-hina"],
    excluded: false,
    needsReview: false,
    counted: true,
    songScore: 92.0,
  },
  {
    videoId: "vid_live",
    title: "[4K 3D Live] 아라하시 타비 3D 데뷔 라이브 무대",
    publishedAt: "2026-05-01T12:00:00Z",
    category: "live_special",
    members: ["arahashi-tabi"],
    excluded: false,
    needsReview: false,
    counted: true,
    songScore: null,
  },
  {
    videoId: "vid_review",
    title: "검토 대기 중인 커버곡 / 사키하네 후야 Cover",
    publishedAt: "2026-11-15",
    category: "solo_cover",
    members: ["sakihane-fuya"],
    excluded: false,
    needsReview: true,
    counted: false,
    songScore: null,
  },
  {
    videoId: "vid_excluded",
    title: "제외된 라이브 / 시즈키 토아",
    publishedAt: "2026-11-14",
    category: "live_special",
    members: ["shizuki-toa"],
    excluded: true,
    needsReview: false,
    counted: false,
    songScore: null,
  },
  {
    videoId: "vid_non_music",
    title: "잡담 방송",
    publishedAt: "2026-11-18",
    category: "non_music",
    members: ["ayatsuno-yuni"],
    excluded: false,
    needsReview: false,
    counted: false,
    songScore: null,
  },
  {
    videoId: "vid_nodate",
    title: "날짜 없는 오리지널 곡",
    publishedAt: null,
    category: "original",
    members: ["akane-lize"],
    excluded: false,
    needsReview: false,
    counted: true,
    songScore: null,
  },
]);

test("normalizeQuery: NFKC, case-insensitive, strips spaces and brackets/punctuation", () => {
  assert.equal(normalizeQuery("괴수의 꽃노래 (怪獣の花唄)"), "괴수의꽃노래怪獣の花唄");
  assert.equal(normalizeQuery("괴수의꽃노래"), "괴수의꽃노래");
  assert.ok(normalizeQuery("괴수의 꽃노래 (怪獣の花唄)").includes(normalizeQuery("괴수의꽃노래")));
  assert.equal(normalizeQuery("（ＳＴＡＲ　ＴＲＡＩＬ）！"), "startrail");
  assert.equal(normalizeQuery("「忘れてください」"), "忘れてください");
  assert.equal(normalizeQuery("『打上花火』 [DAOKO × 요네즈켄시]"), "打上花火daoko요네즈켄시");
  assert.equal(normalizeQuery(null), "");
  assert.equal(normalizeQuery(undefined), "");
});

test("filterSongs: keyword matching ignores spaces, case, NFKC width, and punctuation", () => {
  const hits1 = filterSongs(FIXTURE_ROWS, { query: "괴수의꽃노래" });
  assert.deepEqual(hits1.map((r) => r.videoId), ["vid_solo_new"]);

  const hits2 = filterSongs(FIXTURE_ROWS, { query: "ｓｔａｒ　ｔｒａｉｌ" });
  assert.deepEqual(hits2.map((r) => r.videoId), ["vid_orig"]);

  const hits3 = filterSongs(FIXTURE_ROWS, { query: "4k3dlive" });
  assert.deepEqual(hits3.map((r) => r.videoId), ["vid_live"]);
});

test("filterSongs: collab/group songs appear for every participating effective member", () => {
  const hina = filterSongs(FIXTURE_ROWS, { member: "shirayuki-hina" }).map((r) => r.videoId);
  assert.deepEqual(hina, ["vid_collab", "vid_orig"]);

  const rin = filterSongs(FIXTURE_ROWS, { member: "aokumo-rin" }).map((r) => r.videoId);
  assert.deepEqual(rin, ["vid_collab"]);

  const lize = filterSongs(FIXTURE_ROWS, { member: "akane-lize" }).map((r) => r.videoId);
  assert.deepEqual(lize, ["vid_orig", "vid_nodate"]);
});

test("filterSongs: category mapping (전체 / original / cover / live_special) and music-only filter", () => {
  assert.deepEqual(
    filterSongs(FIXTURE_ROWS, { category: "" }).map((r) => r.videoId),
    ["vid_collab", "vid_solo_new", "vid_live", "vid_orig", "vid_nodate"],
  );
  assert.deepEqual(
    filterSongs(FIXTURE_ROWS, { category: "original" }).map((r) => r.videoId),
    ["vid_orig", "vid_nodate"],
  );
  assert.deepEqual(
    filterSongs(FIXTURE_ROWS, { category: "cover" }).map((r) => r.videoId),
    ["vid_collab", "vid_solo_new"],
  );
  assert.deepEqual(
    filterSongs(FIXTURE_ROWS, { category: "live_special" }).map((r) => r.videoId),
    ["vid_live"],
  );
  // non_music is never returned even if requested directly
  assert.deepEqual(filterSongs(FIXTURE_ROWS, { category: "non_music", includeHidden: true }), []);
});

test("filterSongs: includeHidden toggles needsReview/excluded music rows while still excluding non-music", () => {
  const def = filterSongs(FIXTURE_ROWS).map((r) => r.videoId);
  assert.ok(!def.includes("vid_review"));
  assert.ok(!def.includes("vid_excluded"));
  assert.ok(!def.includes("vid_non_music"));

  const withHidden = filterSongs(FIXTURE_ROWS, { includeHidden: true }).map((r) => r.videoId);
  assert.ok(withHidden.includes("vid_review"));
  assert.ok(withHidden.includes("vid_excluded"));
  assert.ok(!withHidden.includes("vid_non_music"), "non_music stays excluded");
});

test("filterSongs: newest-first sort with null dates last and videoId tie-breaker", () => {
  const unsorted = deepFreeze([
    { videoId: "b_id", title: "B", publishedAt: "2026-01-01", category: "original", members: ["a"], counted: true },
    { videoId: "null_id", title: "Null", publishedAt: null, category: "original", members: ["a"], counted: true },
    { videoId: "a_id", title: "A", publishedAt: "2026-01-01", category: "original", members: ["a"], counted: true },
    { videoId: "newest", title: "New", publishedAt: "2026-11-19T01:00:00Z", category: "solo_cover", members: ["a"], counted: true },
  ]);
  assert.deepEqual(
    filterSongs(unsorted).map((r) => r.videoId),
    ["newest", "a_id", "b_id", "null_id"],
  );
});

test("formatDateOnly: returns YYYY-MM-DD or '-' when missing", () => {
  assert.equal(formatDateOnly("2026-11-08T10:00:09+00:00"), "2026-11-08");
  assert.equal(formatDateOnly("2026-11-11"), "2026-11-11");
  assert.equal(formatDateOnly(null), "-");
  assert.equal(formatDateOnly(""), "-");
});

test("integration with deriveAll(): respects effective overrides and merged ratings", () => {
  const channels = readJson("data/channels-lock.json");
  const videos = readJson("data/videos.json");
  const overrides = clone(readJson("data/overrides.json"));
  const ratings = clone(readJson("data/ratings.json"));
  const baseline = readJson("data/baseline/baseline-2026-11-17.json");

  // Override one video's score in merged ratings
  ratings.videoRatings["CyOAmEihVHs"].songScore = 99.1;
  const d = deriveAll({ channels, videos, overrides, ratings, baseline });

  const allCounted = filterSongs(d.videoRows);
  assert.equal(allCounted.length, d.uniqueVideos);
  assert.equal(allCounted.find((r) => r.videoId === "CyOAmEihVHs").songScore, 99.1);

  // ojV55hcIc4w is excluded by overrides.json: hidden by default, shown with includeHidden
  assert.ok(!allCounted.some((r) => r.videoId === "ojV55hcIc4w"));
  const withHidden = filterSongs(d.videoRows, { includeHidden: true });
  assert.ok(withHidden.some((r) => r.videoId === "ojV55hcIc4w" && r.excluded));

  // Real data match: 怪獣の花唄
  const kaiju = filterSongs(d.videoRows, { query: "怪獣の花唄" });
  assert.equal(kaiju.length, 1);
  assert.equal(kaiju[0].videoId, "of5l0st1kA8");
});

test("keyword also matches previous titles (renamed videos stay findable)", () => {
  const rows = [{ videoId: "of5l0st1kA8", title: "怪獣の花唄 (Vaundy) / 藍璃かんな Cover", category: "solo_cover", members: ["airi-kanna"], publishedAt: "2024-02-10", counted: true }];
  assert.equal(filterSongs(rows, { query: "괴수의꽃노래" }).length, 0);
  assert.equal(filterSongs(rows, { query: "괴수의꽃노래", altTitles: { of5l0st1kA8: ["괴수의 꽃노래 (怪獣の花唄) / 아이리 칸나 Cover"] } }).length, 1);
});
