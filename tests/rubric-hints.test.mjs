import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { RUBRIC_ITEMS } from "../lib/derive.mjs";
import { RUBRIC_HINTS } from "../app/rubric-hints.js";
import { ROOT } from "./load.mjs";

test("rubric-hints: frozen object with exact 10 RUBRIC_ITEMS keys", () => {
  assert.ok(Object.isFrozen(RUBRIC_HINTS));
  assert.deepEqual(Object.keys(RUBRIC_HINTS), RUBRIC_ITEMS.map((i) => i.key));
});

test("rubric-hints: every hint is a non-empty string <= 60 chars", () => {
  for (const it of RUBRIC_ITEMS) {
    const hint = RUBRIC_HINTS[it.key];
    assert.equal(typeof hint, "string", it.key);
    assert.ok(hint.trim().length > 0, `${it.key} is empty`);
    assert.ok(hint.length <= 60, `${it.key} exceeds 60 chars (${hint.length})`);
  }
});

test("rubric-hints: technique hint omits '가성 전환'", () => {
  assert.ok(!RUBRIC_HINTS.technique.includes("가성 전환"));
});

test("rubric-hints: docs/rubric-anchors.md contains each hint verbatim and omits '가성 전환' in technique", () => {
  const doc = readFileSync(path.join(ROOT, "docs", "rubric-anchors.md"), "utf8");
  for (const it of RUBRIC_ITEMS) {
    assert.ok(doc.includes(RUBRIC_HINTS[it.key]), `missing verbatim hint for ${it.key}`);
  }
  assert.ok(!doc.includes("가성 전환"), "docs/rubric-anchors.md still contains '가성 전환'");
});
