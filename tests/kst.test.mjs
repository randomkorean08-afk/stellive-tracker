// Header "데이터 갱신" timestamp is shown in Korea Standard Time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatKst } from "../app/dom.js";

test("formatKst: UTC -> YYYY-MM-DD HH:mm (KST)", () => {
  assert.equal(formatKst("2026-11-22T14:15:24Z"), "2026-11-22 23:15 (KST)");
  assert.equal(formatKst("2026-11-22T15:05:00Z"), "2026-11-23 00:05 (KST)", "date rolls over at KST midnight");
  assert.equal(formatKst("2026-12-31T15:00:00Z"), "2027-01-01 00:00 (KST)", "year rollover");
  assert.equal(formatKst("2026-11-17T00:00:00+09:00"), "2026-11-17 00:00 (KST)", "offset input");
  assert.equal(formatKst(null), "-");
  assert.equal(formatKst("garbage"), "-");
});
