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

test("review fixes: same artist / different song, boilerplate, one-token Latin names, no chaining", () => {
  const mary = ["토키노 메리", "메리", "Tokino Meri", "Meri"];
  const tok = (t) => songTokens(t, mary);
  // same artist (IU), different songs, same day -> different stages
  assert.ok(!sameSong(tok("[겨울잠 | 아이유 (IU)] 토키노 메리 (TOKINO MERY) Live Cover"), tok("[에잇 | 아이유 (IU)] 토키노 메리 (TOKINO MERY) Live Cover")));
  // channel boilerplate must not glue different songs
  assert.ok(!sameSong(tok("[싱크룸/어비스] 토키노메리 × 코가네 랑 - 실루엣 lyrics 가사"), tok("[싱크룸/어비스] 토키노메리 × 코가네 랑 - 블랙록슈터 lyrics 가사")));
  // one-token Latin name: exact only
  assert.ok(!sameSong(["king"], ["king", "gnu"]));
  assert.ok(sameSong(["king"], ["king"]));
  // one-token Korean title may be contained in a bilingual title
  assert.ok(sameSong(["만찬가"], ["만찬가", "晩餐歌"]));
  // no chaining: 0d / 3d / 6d -> the 6d upload is a separate stage
  const rows = [clip("a", "리제 만찬가", "2026-11-01T00:00:00Z"), clip("b", "리제 만찬가", "2026-11-04T00:00:00Z"), clip("c", "리제 만찬가", "2026-11-07T00:00:00Z")];
  assert.equal(collapseDuplicateClips(rows, { aliasesOf }).rows.length, 2);
});

test("no view counts: the newest clip represents the stage; input not mutated", () => {
  const rows = [clip("a", "리제 만찬가", "2026-11-01T00:00:00Z"), clip("b", "리제 만찬가 클립", "2026-11-02T00:00:00Z")];
  const { rows: out } = collapseDuplicateClips(rows, { aliasesOf });
  assert.deepEqual(out.map((r) => r.videoId), ["b"]);
  assert.ok(!("dupCount" in rows[1]));
});
