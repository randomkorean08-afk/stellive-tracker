import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, clone } from "./load.mjs";
import { serializeRatings, serializeOverrides } from "../lib/serialize-export.mjs";

const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
const ratingsText = read("data/ratings.json");
const overridesText = read("data/overrides.json");
const ratings = JSON.parse(ratingsText);
const overrides = JSON.parse(overridesText);
const NOW = "2030-01-01T00:00:00.000Z";
const meta = { exportedAt: NOW, disclaimer: "x" };
const merged = (r) => ({ memberRubric: clone(r.memberRubric), videoRatings: clone(r.videoRatings) });
const ts = (t) => t.replace(/"exportedAt": "[^"]*"/, '"exportedAt": "T"');
const lines = (t) => t.split("\n");
const changedLines = (a, b) => lines(a).flatMap((l, i) => (l === lines(b)[i] ? [] : [i]));

test("empty draft: ratings export is byte-identical to data/ratings.json (except exportedAt)", () => {
  const out = serializeRatings(ratings, merged(ratings), meta);
  assert.equal(ts(out), ts(ratingsText));
  assert.ok(out.includes(`"exportedAt": "${NOW}"`));
});

test("empty draft: overrides export is byte-identical to data/overrides.json", () => {
  assert.equal(serializeOverrides(overrides, { ...overrides, videos: clone(overrides.videos) }), overridesText);
});

test("changing one songScore changes exactly that line (plus timestamp)", () => {
  const id = Object.keys(ratings.videoRatings)[3];
  const m = merged(ratings);
  m.videoRatings[id].songScore = 12.3;
  const out = serializeRatings(ratings, m, meta);
  const diff = changedLines(ratingsText, out);
  assert.equal(diff.length, 2);
  const ln = lines(out)[diff[1]];
  assert.ok(ln.includes(id) && ln.includes('"songScore": 12.3'));
});

test("new video rating is appended at the end, in deterministic order", () => {
  const m = merged(ratings);
  m.videoRatings.zzzzzzzzzzz = { note: "n", ratedAt: "2026-11-20", members: {}, songScore: 50 };
  m.videoRatings.aaaaaaaaaaa = { songScore: 60, members: { "airi-kanna": { tone: 1, pitch: 2 } }, ratedAt: "2026-11-20", note: "" };
  const out = serializeRatings(ratings, m, meta);
  const L = lines(out);
  const n = L.length;
  assert.equal(L[n - 6], lines(ratingsText)[lines(ratingsText).length - 4].replace(/,?$/, ","));
  assert.ok(L[n - 5].startsWith('    "aaaaaaaaaaa": { "songScore": 60.0, "members": { "airi-kanna": { "pitch": 2.0, "tone": 1.0 } }'));
  assert.ok(L[n - 4].startsWith('    "zzzzzzzzzzz": { "songScore": 50.0, "members": {}, "ratedAt": "2026-11-20", "note": "n" }'));
  assert.equal(L[n - 3], "  }");
  assert.deepEqual(JSON.parse(out).videoRatings.aaaaaaaaaaa.members, { "airi-kanna": { pitch: 2, tone: 1 } });
});

test("tombstone (entry absent from merged) removes exactly that entry", () => {
  const id = Object.keys(ratings.videoRatings)[2];
  const m = merged(ratings);
  delete m.videoRatings[id];
  const out = serializeRatings(ratings, m, meta);
  assert.equal(lines(out).length, lines(ratingsText).length - 1);
  assert.ok(!out.includes(id));
  const o2 = serializeOverrides(overrides, { videos: {} });
  assert.deepEqual(JSON.parse(o2).videos, {});
});

test("new member rubric entry: items follow RUBRIC_ITEMS order; existing key order kept", () => {
  const m = merged(ratings);
  const first = Object.keys(m.memberRubric)[0];
  m.memberRubric.newbie = { source: "s", ratedAt: "2026-11-20", items: { live: 1, vocalization: 2, pitch: 3 } };
  const out = serializeRatings(ratings, m, meta);
  assert.deepEqual(Object.keys(JSON.parse(out).memberRubric).slice(0, 2), Object.keys(ratings.memberRubric).slice(0, 2));
  assert.equal(Object.keys(JSON.parse(out).memberRubric).pop(), "newbie");
  assert.ok(out.includes('"newbie":'), first);
  assert.match(out, /"newbie": *\{ "items": \{ "vocalization": 2\.0, "pitch": 3\.0, "live": 1\.0 \}, "ratedAt": "2026-11-20", "source": "s" \}/);
});

test("overrides: changed existing field keeps position; new id appended", () => {
  const id = Object.keys(overrides.videos)[0];
  const v = clone(overrides.videos);
  v[id] = { note: v[id].note, exclude: false };
  v.AAAAAAAAAAA = { exclude: true };
  const out = JSON.parse(serializeOverrides(overrides, { videos: v }));
  assert.deepEqual(Object.keys(out.videos[id]), ["exclude", "note"]);
  assert.equal(Object.keys(out.videos).pop(), "AAAAAAAAAAA");
});
