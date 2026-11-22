// Same-stage duplicate 방송노래 clips: same members + same song + uploads within 3 days -> show the most-viewed one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { songTokens, sameSong, collapseDuplicateClips } from "../lib/clip-dedupe.mjs";

const LIZE = ["아카네 리제", "리제", "Akane Lize", "Lize"];
const aliasesOf = (k) => (k === "akane-lize" ? LIZE : k === "shirayuki-hina" ? ["시라유키 히나", "히나"] : []);
const clip = (videoId, title, publishedAt, members = ["akane-lize"], category = "stream_song") => ({ videoId, title, publishedAt, members, category });

test("songTokens strips member names, brackets, hashtags and modifiers", () => {
  assert.deepEqual(songTokens("[노래방송] 아카네 리제 - 만찬가 (晩餐歌) 라이브 클립 #스텔라이브", LIZE), ["만찬가", "晩餐歌"]);
  assert.deepEqual(songTokens("【리제】 만찬가 풀버전 4K", LIZE), ["만찬가"]);
  assert.ok(sameSong(songTokens("만찬가 / 아카네 리제", LIZE), songTokens("[노래방송] 리제 만찬가 (晩餐歌) 클립", LIZE)));
  assert.ok(!sameSong(songTokens("만찬가 리제", LIZE), songTokens("발묘 리제", LIZE)));
  assert.ok(!sameSong([], ["x"]));
});

test("same member + same song + within 3 days -> only the most-viewed clip is shown", () => {
  const rows = [
    clip("a", "[노래방송] 리제 만찬가 클립", "2026-11-01T10:00:00Z"),
    clip("b", "아카네 리제 - 만찬가 (晩餐歌) LIVE", "2026-11-03T09:00:00Z"),
    clip("c", "만찬가 / Lize 노래 클립", "2026-11-02T00:00:00Z"),
  ];
  const { rows: out, hidden } = collapseDuplicateClips(rows, { views: { a: 100, b: 5000, c: 300 }, aliasesOf });
  assert.deepEqual(out.map((r) => r.videoId), ["b"]);
  assert.equal(out[0].dupCount, 2);
  assert.deepEqual([...hidden].sort(), ["a", "c"]);
});

test("a different day (> 3 days apart) is a different stage -> both shown", () => {
  const rows = [clip("a", "리제 만찬가 클립", "2026-11-01T00:00:00Z"), clip("b", "리제 만찬가 클립", "2026-11-05T00:00:01Z")];
  assert.equal(collapseDuplicateClips(rows, { aliasesOf }).rows.length, 2);
});

test("different members, different songs, or official uploads are never folded", () => {
  const rows = [
    clip("a", "리제 만찬가 클립", "2026-11-01T00:00:00Z"),
    clip("b", "히나 만찬가 클립", "2026-11-01T00:00:00Z", ["shirayuki-hina"]),
    clip("c", "리제 발묘 클립", "2026-11-01T00:00:00Z"),
    clip("d", "만찬가 / 아카네 리제 Cover", "2026-11-01T00:00:00Z", ["akane-lize"], "solo_cover"),
    clip("e", "만찬가 / 아카네 리제 Cover", "2026-11-01T00:00:00Z", ["akane-lize"], "solo_cover"),
  ];
  assert.equal(collapseDuplicateClips(rows, { aliasesOf }).rows.length, 5);
});

test("no view counts: the newest clip represents the stage; input not mutated", () => {
  const rows = [clip("a", "리제 만찬가", "2026-11-01T00:00:00Z"), clip("b", "리제 만찬가 클립", "2026-11-02T00:00:00Z")];
  const { rows: out } = collapseDuplicateClips(rows, { aliasesOf });
  assert.deepEqual(out.map((r) => r.videoId), ["b"]);
  assert.ok(!("dupCount" in rows[1]));
});
