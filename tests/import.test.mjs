import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, readJson, clone } from "./load.mjs";
import { validateImport, memberKeysFrom } from "../lib/import-validate.mjs";

const ratings = readJson("data/ratings.json");
const overrides = readJson("data/overrides.json");
const ctx = {
  memberKeys: memberKeysFrom(readJson("data/channels-lock.json")),
  videoIds: Object.keys(readJson("data/videos.json").videos),
};
const V = Object.keys(ratings.videoRatings)[0];
const M = Object.keys(ratings.memberRubric)[0];
const run = (doc) => validateImport(doc, ctx);
const paths = (doc) => run(doc).errors.map((e) => e.path);

test("context: 15 member keys", () => assert.equal(ctx.memberKeys.length, 15));

test("real ratings.json and overrides.json validate with zero errors", () => {
  assert.deepEqual(run(ratings).errors, []);
  assert.deepEqual(run(overrides).errors, []);
});

test("schemaVersion mismatch rejected", () => {
  const d = clone(ratings); d.schemaVersion = 2;
  assert.ok(paths(d).includes("schemaVersion"));
});

test("non-object / empty doc rejected", () => {
  assert.ok(run([]).errors.length);
  assert.ok(run({ schemaVersion: 1 }).errors.length);
});

test("memberRubric: unknown member, unknown item, range, decimals, non-finite", () => {
  const d = clone(ratings);
  d.memberRubric.nobody = { items: { pitch: 5 } };
  d.memberRubric[M].items.bogus = 1;
  d.memberRubric[M].items.vocalization = 15.5;
  d.memberRubric[M].items.pitch = 9.55;
  d.memberRubric[M].items.rhythm = -1;
  d.memberRubric[M].items.range = null;
  const p = paths(d);
  for (const x of ["memberRubric.nobody", `memberRubric.${M}.items.bogus`, `memberRubric.${M}.items.vocalization`,
    `memberRubric.${M}.items.pitch`, `memberRubric.${M}.items.rhythm`, `memberRubric.${M}.items.range`]) assert.ok(p.includes(x), x);
});

test("memberRubric: per-item max boundary accepted", () => {
  const d = { schemaVersion: 1, memberRubric: { [M]: { items: { vocalization: 15, live: 5, pitch: 0 } } } };
  assert.deepEqual(run(d).errors, []);
  d.memberRubric[M].items.live = 5.1;
  assert.ok(paths(d).length === 1);
});

test("videoRatings: bad id format, id missing from videos.json", () => {
  const d = { schemaVersion: 1, videoRatings: { "short": { songScore: 1 }, "AAAAAAAAAAA": { songScore: 1 } } };
  const p = paths(d);
  assert.ok(p.includes("videoRatings.short") && p.includes("videoRatings.AAAAAAAAAAA"));
});

test("videoRatings: songScore null ok, range and decimals enforced", () => {
  const ok = (s) => run({ schemaVersion: 1, videoRatings: { [V]: { songScore: s } } }).errors.length === 0;
  assert.ok(ok(null) && ok(0) && ok(100) && ok(97.9));
  assert.ok(!ok(100.1) && !ok(-1) && !ok(50.55) && !ok(NaN) && !ok("90"));
});

test("videoRatings.members: unknown member, partial items ok, unknown item, range", () => {
  const mk = (members) => ({ schemaVersion: 1, videoRatings: { [V]: { songScore: null, members } } });
  assert.deepEqual(run(mk({ [M]: { pitch: 80 } })).errors, []); // partial allowed
  assert.deepEqual(run(mk({ [M]: {} })).errors, []);
  assert.ok(paths(mk({ nobody: { pitch: 80 } })).length === 1);
  assert.ok(paths(mk({ [M]: { bogus: 80 } })).length === 1);
  assert.ok(paths(mk({ [M]: { pitch: 101 } })).length === 1);
  assert.ok(paths(mk({ [M]: { highNotes: 80.55 } })).length === 1);
});

test("overrides: bad id, unknown video, invalid category, bad members", () => {
  const mk = (o) => ({ schemaVersion: 1, videos: o });
  assert.ok(paths(mk({ bad: { exclude: true } })).length === 1);
  assert.ok(paths(mk({ AAAAAAAAAAA: { exclude: true } })).length === 1);
  assert.ok(paths(mk({ [V]: { category: "nope" } })).includes(`videos.${V}.category`));
  assert.ok(paths(mk({ [V]: { members: "akane-lize" } })).includes(`videos.${V}.members`));
  assert.ok(paths(mk({ [V]: { members: ["nobody"] } })).includes(`videos.${V}.members[0]`));
  assert.deepEqual(run(mk({ [V]: { category: "solo_cover", members: [M] } })).errors, []);
});

test("unknown top-level key is a warning, not an error", () => {
  const d = clone(overrides); d.extra = 1;
  const r = run(d);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings.map((w) => w.path), ["extra"]);
});

test("lib/import-validate.mjs is browser-safe (no Node imports)", () => {
  const src = readFileSync(path.join(ROOT, "lib", "import-validate.mjs"), "utf8");
  assert.ok(!/from\s+["']node:/.test(src) && !/require\(/.test(src) && !/process\./.test(src));
});
