import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_RATED, RUBRIC_ITEMS, VIDEO_ITEMS, CATEGORIES, effective, songScore, memberVideoScore, grade, deriveAll,
} from "../lib/derive.mjs";
import { readJson, clone, deepFreeze } from "./load.mjs";

const channels = readJson("data/channels-lock.json");
const videos = readJson("data/videos.json");
const ratings = readJson("data/ratings.json");
const overrides = readJson("data/overrides.json");
const baseline = readJson("data/baseline/baseline-2026-11-17.json");

const run = (over = {}) => deriveAll({ channels, videos, overrides, ratings, baseline, ...over });
const card = (d, k) => d.memberCards.find((c) => c.key === k);

test("constants", () => {
  assert.equal(MIN_RATED, 3);
  assert.equal(RUBRIC_ITEMS.length, 10);
  assert.equal(RUBRIC_ITEMS.reduce((s, i) => s + i.max, 0), 100);
  assert.equal(RUBRIC_ITEMS.find((i) => i.key === "vocalization").max, 15);
  assert.equal(RUBRIC_ITEMS.find((i) => i.key === "live").max, 5);
  assert.equal(RUBRIC_ITEMS.filter((i) => i.group === "physical").reduce((s, i) => s + i.max, 0), 55);
  assert.equal(VIDEO_ITEMS.length, 5);
  assert.equal(CATEGORIES.filter((c) => c.counted).length, 4);
});

test("rubric totals match baseline reportedRubricTotals to 1 decimal (15 members)", () => {
  const d = run();
  const reported = Object.entries(baseline.reportedRubricTotals).filter(([k]) => !k.startsWith("_"));
  assert.equal(reported.length, 15);
  for (const [k, v] of reported) {
    const c = card(d, k);
    assert.ok(c, k);
    assert.equal(c.rubricTotal, v, `${k}: ${c.rubricTotal} vs ${v} (exact, no float drift)`);
    assert.equal(Math.round((c.physical + c.interpretive) * 10) / 10, c.rubricTotal);
  }
});

test("grades match the baseline PDF table for all 15 members", () => {
  const pdfGrades = {
    "akane-lize": "S+", "airi-kanna": "S+", "tokino-meri": "S+", "hanako-nana": "S", "shirayuki-hina": "S",
    "aokumo-rin": "S", "yuzuha-riko": "S", "tenko-shibuki": "A+", "shizuki-toa": "A+", "neneko-mashiro": "A+",
    "arahashi-tabi": "A+", "hanayo-hiyori": "A", "sakihane-fuya": "A", "kogane-rang": "A", "ayatsuno-yuni": "B+",
  };
  const d = run();
  for (const [k, g] of Object.entries(pdfGrades)) assert.equal(card(d, k).grade, g, k);
});

test("rankA is a 1..15 permutation ordered by A desc", () => {
  const d = run();
  const ranks = d.memberCards.map((c) => c.rankA);
  assert.deepEqual([...ranks], Array.from({ length: 15 }, (_, i) => i + 1));
  for (let i = 1; i < d.memberCards.length; i++) assert.ok(d.memberCards[i - 1].rubricTotal >= d.memberCards[i].rubricTotal);
});

test("grade boundaries", () => {
  const cases = [[100, "S+"], [95, "S+"], [94.9999, "S"], [90, "S"], [89.99, "A+"], [85, "A+"], [84.99, "A"], [80, "A"], [79.99, "B+"], [75, "B+"], [74.99, "B"], [0, "B"], [null, null], [NaN, null]];
  for (const [v, g] of cases) assert.equal(grade(v), g, String(v));
});

test("rankB is null below MIN_RATED and present at/above", () => {
  const d = run();
  for (const c of d.memberCards) {
    if (c.songAvgN < MIN_RATED) assert.equal(c.rankB, null, c.key);
    else assert.ok(c.rankB >= 1, c.key);
  }
  assert.ok(d.memberCards.some((c) => c.songAvgN > 0 && c.songAvgN < MIN_RATED), "fixture has a below-threshold member with a value");
  assert.ok(d.memberCards.some((c) => c.rankB !== null));
});

test("unrated video: A, B, ranks unchanged; only slots (+1) and unratedCount move", () => {
  const base = run();
  const v2 = clone(videos);
  v2.videos["Aa1Bb2Cc3Dd"] = {
    videoId: "Aa1Bb2Cc3Dd", title: "새 곡 / 아카네 리제 Cover", previousTitles: [], channelKey: "akane-lize", seenOnChannels: ["akane-lize"],
    publishedAt: "2026-11-19", source: "rss", firstSeenAt: "2026-11-19T00:00:00Z", lastSeenInFeedAt: null, status: "unverified", statusCheckedAt: null, failStreak: 0,
    auto: { category: "solo_cover", members: ["akane-lize"], matchedRules: ["R40-cover"], reviewRequired: false, reviewReasons: [] },
  };
  const after = run({ videos: v2 });
  for (const c of base.memberCards) {
    const a = card(after, c.key);
    assert.equal(a.rubricTotal, c.rubricTotal);
    assert.equal(a.songAvg, c.songAvg);
    assert.equal(a.songAvgN, c.songAvgN);
    assert.equal(a.rankA, c.rankA);
    assert.equal(a.rankB, c.rankB);
  }
  assert.equal(card(after, "akane-lize").slots.solo_cover, card(base, "akane-lize").slots.solo_cover + 1);
  assert.equal(card(after, "akane-lize").slots.total, card(base, "akane-lize").slots.total + 1);
  assert.equal(card(after, "akane-lize").unratedCount, card(base, "akane-lize").unratedCount + 1);
  assert.equal(after.uniqueVideos, base.uniqueVideos + 1);
  assert.equal(after.totalSlots, base.totalSlots + 1);
});

test("memberVideoScore: needs all 5 items; partial is ignored; mean otherwise; falls back to songScore", () => {
  const r = clone(ratings);
  const id = "R_B4tmy2DVA";
  r.videoRatings[id].members = { "akane-lize": { pitch: 98, tone: 99, expression: 99, highNotes: 97 } };
  assert.equal(memberVideoScore("akane-lize", id, r), null);
  const d1 = run({ ratings: r });
  assert.equal(card(d1, "akane-lize").songAvg, card(run(), "akane-lize").songAvg, "partial input changes nothing");
  r.videoRatings[id].members["akane-lize"].stability = 98;
  assert.equal(memberVideoScore("akane-lize", id, r), (98 + 99 + 99 + 97 + 98) / 5);
  assert.equal(songScore(id, r), 98.4);
  assert.equal(songScore("zzzzzzzzzzz", r), null);
  const d2 = run({ ratings: r });
  assert.notEqual(card(d2, "akane-lize").songAvg, card(run(), "akane-lize").songAvg);
});

test("deleted videos stay counted and are reported separately", () => {
  const base = run();
  const v2 = clone(videos);
  v2.videos["CyOAmEihVHs"].status = "deleted";
  const d = run({ videos: v2 });
  assert.equal(d.uniqueVideos, base.uniqueVideos);
  assert.equal(d.deletedCount, 1);
  assert.equal(card(d, "akane-lize").deletedCount, 1);
  assert.equal(card(d, "akane-lize").songAvg, card(base, "akane-lize").songAvg, "rating preserved");
  assert.equal(d.videoRows.find((r) => r.videoId === "CyOAmEihVHs").counted, true);
});

test("overrides: exclude / reviewed / category / members", () => {
  // 실제 overrides.json에서 STAR TRAIL(2026-11-21 사용자 확정)만 뺀 것을 기준으로 reviewed 경로를 검증한다
  const { "v094-E3Pmtk": starTrail, ...restVideos } = overrides.videos;
  const ovBase = { ...overrides, videos: restVideos };
  // collection rewrites auto from the real title; force the review-required state so this test does not depend on it
  const vReview = clone(videos);
  vReview.videos["v094-E3Pmtk"].auto = { ...vReview.videos["v094-E3Pmtk"].auto, category: "original", reviewRequired: true, reviewReasons: ["group_expansion"] };
  const run = (over = {}) => deriveAll({ channels, videos: vReview, overrides, ratings, baseline, ...over });
  const base = run({ overrides: ovBase });
  assert.equal(base.videoRows.find((r) => r.videoId === "v094-E3Pmtk").counted, false, "needs review -> not counted");
  assert.ok(base.reviewQueue.includes("v094-E3Pmtk"));

  const ov = (extra) => ({ overrides: { ...ovBase, videos: { ...ovBase.videos, ...extra } } });
  const reviewed = run(ov({ "v094-E3Pmtk": { reviewed: true } }));
  assert.equal(reviewed.videoRows.find((r) => r.videoId === "v094-E3Pmtk").counted, true);
  assert.equal(reviewed.uniqueVideos, base.uniqueVideos + 1);
  assert.ok(!reviewed.reviewQueue.includes("v094-E3Pmtk"));

  const excluded = run(ov({ "CyOAmEihVHs": { exclude: true } }));
  assert.equal(excluded.uniqueVideos, base.uniqueVideos - 1);
  assert.equal(card(excluded, "akane-lize").slots.solo_cover, card(base, "akane-lize").slots.solo_cover - 1);

  const recat = run(ov({ "CyOAmEihVHs": { category: "original" } }));
  assert.equal(card(recat, "akane-lize").slots.original, card(base, "akane-lize").slots.original + 1);
  assert.equal(card(recat, "akane-lize").slots.solo_cover, card(base, "akane-lize").slots.solo_cover - 1);

  const mem = run(ov({ "CyOAmEihVHs": { members: ["akane-lize", "shirayuki-hina"] } }));
  assert.equal(card(mem, "shirayuki-hina").slots.solo_cover, card(base, "shirayuki-hina").slots.solo_cover + 1);
  assert.equal(mem.totalSlots, base.totalSlots + 1);
  assert.equal(mem.uniqueVideos, base.uniqueVideos);

  // the real user override: STAR TRAIL counted, 9 members, review queue empty
  assert.equal(starTrail.reviewed, true);
  const real = run();
  const st = real.videoRows.find((r) => r.videoId === "v094-E3Pmtk");
  assert.equal(st.counted, true);
  assert.equal(starTrail.members.length, 9);
  assert.ok(!starTrail.members.includes("sakihane-fuya") && !starTrail.members.includes("airi-kanna"));
  assert.ok(!real.reviewQueue.includes("v094-E3Pmtk"), "STAR TRAIL no longer waits for review");

  const e = effective({ auto: { category: "solo_cover", members: ["a"], reviewRequired: true } }, { reviewed: true, exclude: true });
  assert.deepEqual(e, { category: "solo_cover", members: ["a"], excluded: true, needsReview: false });
});

test("unknown category / excluded categories are not counted", () => {
  const v2 = clone(videos);
  v2.videos["CyOAmEihVHs"].auto.category = "unknown";
  v2.videos["liPEQZJLQh4"].auto.category = "excluded_stream";
  const d = run({ videos: v2 });
  assert.equal(d.uniqueVideos, run().uniqueVideos - 2);
  assert.ok(d.reviewQueue.includes("CyOAmEihVHs"));
});

test("baselineDiff is display-only and does not feed calculations", () => {
  const d = run();
  const row = d.baselineDiff["akane-lize"].solo_cover;
  assert.equal(row.baseline, 33);
  assert.equal(row.delta, row.derived - 33);
  const noBase = run({ baseline: null });
  assert.deepEqual(noBase.baselineDiff, {});
  assert.equal(noBase.uniqueVideos, d.uniqueVideos);
  assert.equal(card(noBase, "akane-lize").songAvg, card(d, "akane-lize").songAvg);
});

test("pure: frozen inputs are not mutated and output is deterministic", () => {
  const inputs = deepFreeze({ channels: clone(channels), videos: clone(videos), overrides: clone(overrides), ratings: clone(ratings), baseline: clone(baseline) });
  const a = deriveAll(inputs);
  const b = deriveAll(inputs);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(inputs.ratings), JSON.stringify(ratings));
});

test("works with empty / missing inputs", () => {
  const d = deriveAll({});
  assert.equal(d.uniqueVideos, 0);
  assert.deepEqual(d.memberCards, []);
});
