// 2026-11-20 확정 수정 사항 회귀 테스트: 서브 채널 귀속, Topic 수집 제외, 별칭, 집계 제외 overrides.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { classify } from "../lib/classify.mjs";
import { deriveAll } from "../lib/derive.mjs";
import { readJson, ROOT } from "./load.mjs";

const lock = readJson("data/channels-lock.json");
const videos = readJson("data/videos.json");
const ratings = readJson("data/ratings.json");
const overrides = readJson("data/overrides.json");
const baseline = readJson("data/baseline/baseline-2026-11-17.json");
const run = (over = {}) => deriveAll({ channels: lock, videos, overrides, ratings, baseline, ...over });
const card = (d, k) => d.memberCards.find((c) => c.key === k);
// 2026-11-21: airi-kanna-music was merged into airi-kanna (same channel @airikanna). member-sub support stays in
// classify(), so these tests use a synthetic sub-channel attached to the real lock.
const subLock = { ...lock, channels: [...lock.channels, { key: "test-kanna-sub", type: "member-sub", memberKey: "airi-kanna", unit: "gen1-mystic", verified: false, collect: "none", aliases: [] }] };

test("member-sub channel: uploads are attributed to memberKey, not to the sub-channel", () => {
  const sub = subLock.channels.find((c) => c.key === "test-kanna-sub");
  assert.equal(sub.type, "member-sub");
  assert.equal(sub.memberKey, "airi-kanna");
  const r = classify({ title: "괴수의 꽃노래 (怪獣の花唄) / 아이리 칸나 Cover", channelKey: "test-kanna-sub", publishedAt: "2024-02-10" }, subLock);
  assert.equal(r.category, "solo_cover");
  assert.deepEqual(r.members, ["airi-kanna"]);
  assert.equal(r.reviewRequired, false);
});

test("member-sub channel: title without the member name is still attributed to the owner", () => {
  const r = classify({ title: "최종화 (The Last Flower) Official MV", channelKey: "test-kanna-sub", publishedAt: "2024-03-01" }, subLock);
  assert.equal(r.category, "original");
  assert.deepEqual(r.members, ["airi-kanna"]);
});

test("member-sub channel: post-graduation upload goes to the review queue (owner's graduatedAt 2024-12-02)", () => {
  const before = classify({ title: "새 노래 / 아이리 칸나 Cover", channelKey: "test-kanna-sub", publishedAt: "2024-12-02" }, subLock);
  assert.ok(!before.reviewReasons.includes("post_graduation_upload"), "graduation day itself is not 'after'");
  const after = classify({ title: "새 노래 / 아이리 칸나 Cover", channelKey: "test-kanna-sub", publishedAt: "2024-12-03" }, subLock);
  assert.equal(after.reviewRequired, true);
  assert.ok(after.reviewReasons.includes("post_graduation_upload"));
});

test("Kanna: single merged channel entry; seeds point at it and still classify identically", () => {
  assert.ok(!lock.channels.some((c) => c.key === "airi-kanna-music"), "merged into airi-kanna");
  const k = lock.channels.find((c) => c.key === "airi-kanna");
  assert.equal(k.handle, "@airikanna");
  assert.equal(k.channelId, "UC6YnTqZidFg4WUiXpiCtSSQ");
  for (const id of ["iCCqSFvz9kM", "of5l0st1kA8", "zNYEbJr1xj4"]) {
    const v = videos.videos[id];
    assert.equal(v.channelKey, "airi-kanna", id);
    const r = classify({ title: v.title, channelKey: v.channelKey, publishedAt: v.publishedAt }, lock);
    assert.deepEqual(r.members, ["airi-kanna"], id);
    assert.equal(r.category, v.auto.category, id);
  }
});

test("Topic channel: registered as group-sub with collect:none; its seed is kept", () => {
  const topic = lock.channels.find((c) => c.key === "stellive-topic");
  assert.equal(topic.type, "group-sub");
  assert.equal(topic.collect, "none");
  const v = videos.videos["Ei7yWYi7x_E"];
  assert.ok(v, "seed kept");
  assert.equal(v.channelKey, "stellive-topic");
  const r = classify({ title: v.title, channelKey: v.channelKey, publishedAt: v.publishedAt }, lock);
  assert.equal(r.category, "original");
  assert.deepEqual(new Set(r.members), new Set(["tokino-meri", "shizuki-toa", "hanayo-hiyori", "kogane-rang"]));
});

test("collector skips collect:none channels even when verified", () => {
  const src = readFileSync(path.join(ROOT, "scripts/fetch-videos.mjs"), "utf8");
  assert.match(src, /c\.collect !== "none"/);
});

test("sub-channels never create extra member cards (still 15)", () => {
  const d = run();
  assert.equal(d.memberCards.length, 15);
  assert.ok(!d.memberCards.some((c) => c.key === "airi-kanna-music" || c.key === "stellive-topic"));
});

test("official romanizations Huya / Cogane are detected as full names", () => {
  const a = classify({ title: "별자리가 될 수 있다면 / Sakihane Huya Cover", channelKey: "stellive", publishedAt: "2025-08-20" }, lock);
  assert.deepEqual(a.members, ["sakihane-fuya"]);
  const b = classify({ title: "호랑풍류가 / Cogane Rang Cover", channelKey: "stellive", publishedAt: "2026-10-17" }, lock);
  assert.deepEqual(b.members, ["kogane-rang"]);
});

test("excluded seeds: rows/ratings kept, but no longer counted in slots or B", () => {
  const d = run();
  for (const id of ["eSI7RsjZy1E", "ojV55hcIc4w"]) {
    const row = d.videoRows.find((r) => r.videoId === id);
    assert.ok(row, `${id} row kept`);
    assert.equal(row.excluded, true);
    assert.equal(row.counted, false);
    assert.equal(typeof ratings.videoRatings[id].songScore, "number", `${id} rating preserved`);
  }
  const meri = card(d, "tokino-meri");
  assert.equal(meri.songAvgN, 1);
  assert.equal(meri.songAvg, 94.2);
  assert.equal(meri.rankB, null);
  const toa = card(d, "shizuki-toa");
  assert.equal(toa.songAvgN, 2);
  assert.equal(toa.rankB, null);
  // A(루브릭)는 영상 제외와 무관
  assert.equal(meri.rubricTotal, 95);
  assert.equal(meri.grade, "S+");
});
