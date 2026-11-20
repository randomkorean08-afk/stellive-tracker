import { test } from "node:test";
import assert from "node:assert/strict";
import { hashString, canonical, fingerprintRepo, detectDraftConflicts, countDraftEntries, describeStale } from "../lib/draft-guard.mjs";

const ratings = (vr = {}, mr = {}, exportedAt = "2026-11-01") => ({ schemaVersion: 1, exportedAt, memberRubric: mr, videoRatings: vr });
const overrides = (videos = {}) => ({ schemaVersion: 1, videos });
const draft = (over = {}) => ({
  ratings: { memberRubric: {}, videoRatings: {}, ...(over.ratings ?? {}) },
  overrides: { videos: {}, ...(over.overrides ?? {}) },
  base: over.base ?? null,
});

test("hashString is deterministic and discriminating", () => {
  assert.equal(hashString("abc"), hashString("abc"));
  assert.notEqual(hashString("abc"), hashString("abd"));
  assert.match(hashString(""), /^[0-9a-f]{8}$/);
});

test("canonical ignores key order", () => {
  assert.equal(canonical({ a: 1, b: { c: 2, d: 3 } }), canonical({ b: { d: 3, c: 2 }, a: 1 }));
});

test("fingerprint: same data same hash; changed value changes hash and key hash", () => {
  const a = fingerprintRepo(ratings({ v1: { songScore: 5 } }), overrides());
  const b = fingerprintRepo(ratings({ v1: { songScore: 5 } }), overrides());
  const c = fingerprintRepo(ratings({ v1: { songScore: 6 } }), overrides());
  assert.equal(a.hash, b.hash);
  assert.notEqual(a.hash, c.hash);
  assert.notEqual(a.keys.videoRatings.v1, c.keys.videoRatings.v1);
  assert.equal(a.ratingsAt, "2026-11-01");
});

test("empty draft is never stale", () => {
  const fp = fingerprintRepo(ratings(), overrides());
  assert.equal(detectDraftConflicts(draft(), fp).stale, false);
});

test("matching base is not stale", () => {
  const fp = fingerprintRepo(ratings({ v1: { songScore: 5 } }), overrides());
  const d = draft({ ratings: { videoRatings: { v1: { songScore: 9 } } }, base: fp });
  const r = detectDraftConflicts(d, fp);
  assert.equal(r.stale, false);
  assert.equal(r.entryCount, 1);
});

test("changed base: only keys whose repo value changed count as conflicts", () => {
  const oldFp = fingerprintRepo(ratings({ v1: { songScore: 5 }, v2: { songScore: 4 } }), overrides());
  const newFp = fingerprintRepo(ratings({ v1: { songScore: 6 }, v2: { songScore: 4 } }), overrides());
  const d = draft({ ratings: { videoRatings: { v1: { songScore: 9 }, v2: { songScore: 9 }, v3: { songScore: 1 } } }, base: oldFp });
  const r = detectDraftConflicts(d, newFp);
  assert.equal(r.stale, true);
  assert.equal(r.unknownBase, false);
  assert.equal(r.entryCount, 3);
  assert.deepEqual(r.conflicts, [{ section: "videoRatings", key: "v1" }]);
});

test("key newly added to repo after draft base counts as conflict; tombstones are entries", () => {
  const oldFp = fingerprintRepo(ratings(), overrides());
  const newFp = fingerprintRepo(ratings(), overrides({ x: { category: "cover" } }));
  const d = draft({ overrides: { videos: { x: { category: "original" }, y: null } }, base: oldFp });
  const r = detectDraftConflicts(d, newFp);
  assert.equal(r.stale, true);
  assert.deepEqual(r.conflicts, [{ section: "overrides", key: "x" }]);
  assert.equal(countDraftEntries(d), 2);
});

test("old draft without base = unknown base, stale; conflicts are overlapping repo keys", () => {
  const fp = fingerprintRepo(ratings({ v1: { songScore: 5 } }), overrides());
  const d = draft({ ratings: { videoRatings: { v1: { songScore: 9 }, v2: { songScore: 1 } } } });
  const r = detectDraftConflicts(d, fp);
  assert.equal(r.stale, true);
  assert.equal(r.unknownBase, true);
  assert.deepEqual(r.conflicts, [{ section: "videoRatings", key: "v1" }]);
  assert.match(describeStale(r), /알 수 없습니다/);
});

test("describeStale reports counts in Korean", () => {
  const msg = describeStale({ unknownBase: false, entryCount: 3, conflicts: [{}, {}] });
  assert.match(msg, /3건/);
  assert.match(msg, /2건/);
});
