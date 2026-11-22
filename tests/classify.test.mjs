import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../lib/classify.mjs";
import { readJson } from "./load.mjs";

const lock = readJson("data/channels-lock.json");
const fx = readJson("tests/fixtures/classification-cases.json");
const videos = readJson("data/videos.json");

for (const c of fx.cases) {
  test(`classify ${c.id}`, () => {
    const r = classify(c.input, lock, c.ctx ?? {});
    const e = c.expected;
    assert.equal(r.category, e.category, "category");
    assert.equal(r.reviewRequired, e.reviewRequired, "reviewRequired");
    if (e.membersMode !== "any") assert.deepEqual([...r.members].sort(), [...e.members].sort(), "members");
    for (const reason of e.reasons ?? []) assert.ok(r.reviewReasons.includes(reason), `reason ${reason} in ${r.reviewReasons}`);
  });
}

const seeds = Object.values(videos.videos).filter((v) => v.source === "seed");

test("seed count is 27", () => assert.equal(seeds.length, 27));

for (const v of seeds) {
  test(`seed ${v.videoId} reclassifies to stored auto`, () => {
    const r = classify({ title: v.title, channelKey: v.channelKey, publishedAt: v.publishedAt, isShort: v.isShort ?? null }, lock);
    assert.equal(r.category, v.auto.category);
    assert.deepEqual([...r.members].sort(), [...v.auto.members].sort());
    assert.equal(r.reviewRequired, v.auto.reviewRequired);
    assert.deepEqual([...r.reviewReasons].sort(), [...v.auto.reviewReasons].sort());
    assert.deepEqual(r.matchedRules, v.auto.matchedRules);
  });
}

test("non_music / excluded never carry member-related review reasons", () => {
  const r = classify({ title: "스텔라이브 MVP 시상식 3기", channelKey: "stellive", publishedAt: "2026-11-01" }, lock);
  assert.equal(r.category, "non_music");
  assert.deepEqual(r.reviewReasons, []);
});

test("group expansion respects join/graduation dates", () => {
  const early = classify({ title: "스텔라이브 'STAR TRAIL' Official MV", channelKey: "stellive", publishedAt: "2024-06-01" }, lock);
  assert.ok(early.members.includes("airi-kanna"));
  assert.ok(!early.members.includes("tokino-meri"));
  const late = classify({ title: "스텔라이브 'STAR TRAIL' Official MV", channelKey: "stellive", publishedAt: "2026-11-05" }, lock);
  assert.ok(!late.members.includes("airi-kanna"));
  assert.ok(late.members.includes("tokino-meri"));
});
