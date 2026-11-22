// Shorts format check: a verified YouTube Short is never a music video, even if its title says "cover".
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../lib/classify.mjs";
import { checkShortFormat, pickShortTargets, applyShortFormat } from "../lib/collector.mjs";
import { readJson } from "./load.mjs";

const lock = readJson("data/channels-lock.json");

test("classify: isShort=true -> excluded_short (R05) even for a cover title", () => {
  const title = "너에게 메롱 / 텐코 시부키 3D Cover #스텔라이브 #텐코시부키";
  const long = classify({ title, channelKey: "tenko-shibuki", publishedAt: "2025-01-01" }, lock);
  assert.notEqual(long.category, "excluded_short");
  const short = classify({ title, channelKey: "tenko-shibuki", publishedAt: "2025-01-01", isShort: true }, lock);
  assert.equal(short.category, "excluded_short");
  assert.ok(short.matchedRules.includes("R05-short-format"));
  const notShort = classify({ title, channelKey: "tenko-shibuki", publishedAt: "2025-01-01", isShort: false }, lock);
  assert.equal(notShort.category, long.category, "isShort=false keeps the title-based result");
});

test("checkShortFormat: 200 -> true, 3xx -> false, other/error -> null (uses redirect: manual)", async () => {
  const fake = (status) => async (url, init) => { assert.match(url, /\/shorts\//); assert.equal(init.redirect, "manual"); return { status }; };
  assert.equal(await checkShortFormat("dR6Qwbyi4hY", { fetchImpl: fake(200) }), true);
  assert.equal(await checkShortFormat("1QBHHcbv9TU", { fetchImpl: fake(303) }), false);
  assert.equal(await checkShortFormat("x", { fetchImpl: fake(429) }), null);
  assert.equal(await checkShortFormat("x", { fetchImpl: async () => { throw new Error("net"); } }), null);
});

test("pickShortTargets: unchecked music/unknown only, override category wins, skips deleted", () => {
  const v = (id, cat, extra = {}) => ({ videoId: id, status: "active", auto: { category: cat }, ...extra });
  const videos = {
    a: v("a", "solo_cover"), b: v("b", "non_music"), c: v("c", "unknown"),
    d: v("d", "solo_cover", { isShort: false }), e: v("e", "solo_cover", { status: "deleted" }), f: v("f", "non_music"),
  };
  assert.deepEqual(pickShortTargets(videos, { overrides: { f: { category: "original" } } }), ["a", "c", "f"]);
  assert.deepEqual(pickShortTargets(videos, { limit: 1 }), ["a"]);
});

test("applyShortFormat: true reclassifies to excluded_short; null leaves the entry untouched", () => {
  const entry = { videoId: "HcfqHPrv5ik", title: "너에게 메롱 / 텐코 시부키 3D Cover", channelKey: "tenko-shibuki", publishedAt: "2025-01-01", auto: { category: "solo_cover" } };
  assert.equal(applyShortFormat(entry, null, lock), entry);
  const s = applyShortFormat(entry, true, lock);
  assert.equal(s.isShort, true);
  assert.equal(s.auto.category, "excluded_short");
  assert.equal(applyShortFormat(entry, false, lock).isShort, false);
});

test("real data: no counted music video is a verified Short", () => {
  const videos = readJson("data/videos.json").videos;
  for (const v of Object.values(videos)) if (v.isShort === true) assert.equal(v.auto.category, "excluded_short", v.videoId);
});
