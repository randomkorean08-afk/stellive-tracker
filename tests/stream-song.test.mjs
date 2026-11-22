// 방송노래 (stream_song): songs sung on stream / clipper clips. Listed in the archive, never counted or evaluated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../lib/classify.mjs";
import { deriveAll, CATEGORIES } from "../lib/derive.mjs";
import { buildManualClip, reclassify, mergeEntries } from "../lib/collector.mjs";
import { filterSongs, sortSongs, isEvaluated } from "../lib/song-search.mjs";
import { parseArgs, resolveMembers } from "../scripts/add-clip.mjs";
import { readJson, clone } from "./load.mjs";

const lock = readJson("data/channels-lock.json");
const NOW = "2026-11-22T00:00:00Z";
const c = (title, channelKey = "akane-lize") => classify({ title, channelKey, publishedAt: "2026-01-01" }, lock);

test("category exists: listed, not counted", () => {
  const cat = CATEGORIES.find((x) => x.key === "stream_song");
  assert.equal(cat.label, "방송노래");
  assert.equal(cat.counted, false);
  assert.equal(cat.listed, true);
});

test("classify: strong singing keywords -> stream_song automatically", () => {
  // (clip + song titles such as "노래 클립 모음" still hit R25 -> live_special until fixture T07 is approved to change)
  for (const t of ["리제 가창 모음", "히나 열창 컷", "Lize singing session"]) {
    const r = c(t);
    assert.equal(r.category, "stream_song", t);
    assert.equal(r.reviewRequired, false, t);
  }
});

test("classify: weak keywords -> stream_song candidate in the review queue", () => {
  const r = c("유니가 부른 [용한소녀] 오프닝", "ayatsuno-yuni");
  assert.equal(r.category, "stream_song");
  assert.equal(r.reviewRequired, true);
  assert.ok(r.reviewReasons.includes("stream_song_weak"));
});

test("classify: no false positives on chat/game clips", () => {
  for (const t of ["노래방 앞에서 실종된 보스의 위엄 [봉누도2]", "'아빠'라고 불러봤더니 생긴 일", "스텔라이브 알파피메일 정히나【히나 핫클립 #76】"]) {
    assert.notEqual(c(t, "shirayuki-hina").category, "stream_song", t);
  }
  assert.equal(c("노래방송 다시보기", "akane-lize").category, "excluded_stream", "full singing-stream VOD stays excluded (D4)");
  assert.equal(c("출항 / 아카네 리제 Cover").category, "solo_cover", "official cover unchanged");
});

test("derive: stream_song is listed but not counted in slots, uniqueVideos or B", () => {
  const base = {
    channels: lock, videos: readJson("data/videos.json"), overrides: readJson("data/overrides.json"),
    ratings: clone(readJson("data/ratings.json")), baseline: readJson("data/baseline/baseline-2026-11-17.json"),
  };
  const v2 = clone(base.videos);
  v2.videos.ZZZZZZZZZZZ = buildManualClip({ videoId: "ZZZZZZZZZZZ", title: "발묘 노래방송 컷", members: ["akane-lize"] }, NOW);
  base.ratings.videoRatings.ZZZZZZZZZZZ = { songScore: 10, members: {} }; // even if rated, never evaluated
  const before = deriveAll(base);
  const after = deriveAll({ ...base, videos: v2 });
  const row = after.videoRows.find((r) => r.videoId === "ZZZZZZZZZZZ");
  assert.equal(row.listed, true);
  assert.equal(row.counted, false);
  assert.equal(after.uniqueVideos, before.uniqueVideos);
  assert.equal(after.totalSlots, before.totalSlots);
  const a = after.memberCards.find((x) => x.key === "akane-lize");
  const b = before.memberCards.find((x) => x.key === "akane-lize");
  assert.equal(a.songAvg, b.songAvg);
  assert.equal(a.songAvgN, b.songAvgN);
});

test("manual clip: fixed category/members, never re-classified, kept by merges", () => {
  const e = buildManualClip({ videoId: "https://youtu.be/ZZZZZZZZZZZ", title: "잡담 중 갑자기 (no keywords)", members: ["akane-lize"], song: "발묘", authorName: "클리퍼" }, NOW);
  assert.equal(e.videoId, "ZZZZZZZZZZZ");
  assert.equal(e.source, "manual");
  assert.equal(e.auto.category, "stream_song");
  assert.equal(reclassify(e, lock), e);
  const m = mergeEntries({ ZZZZZZZZZZZ: e }, [], lock, NOW, { reclassifyAll: true });
  assert.equal(m.videos.ZZZZZZZZZZZ.auto.category, "stream_song");
  assert.throws(() => buildManualClip({ videoId: "x", members: ["a"] }, NOW));
  assert.throws(() => buildManualClip({ videoId: "ZZZZZZZZZZZ", members: [] }, NOW));
});

test("add-clip CLI: args and member names", () => {
  const o = parseArgs(["https://youtu.be/ZZZZZZZZZZZ", "--members", "아카네", "리제,", "shirayuki-hina", "--song", "발묘", "--dry-run"]);
  assert.equal(o.target, "https://youtu.be/ZZZZZZZZZZZ");
  assert.deepEqual(resolveMembers(o.members, lock), ["akane-lize", "shirayuki-hina"]);
  assert.equal(o.song, "발묘");
  assert.equal(o.dryRun, true);
  assert.throws(() => resolveMembers(["없는멤버"], lock));
});

test("search filters: 방송노래 only / 정식 투고만 / score sort ignores 방송노래", () => {
  const rows = [
    { videoId: "s", title: "a", category: "stream_song", members: ["m"], publishedAt: "2026-01-02", listed: true, counted: false, songScore: 99 },
    { videoId: "o", title: "b", category: "solo_cover", members: ["m"], publishedAt: "2026-01-01", listed: true, counted: true, songScore: 90 },
  ];
  assert.deepEqual(filterSongs(rows).map((r) => r.videoId), ["s", "o"]);
  assert.deepEqual(filterSongs(rows, { category: "stream_song" }).map((r) => r.videoId), ["s"]);
  assert.deepEqual(filterSongs(rows, { category: "official" }).map((r) => r.videoId), ["o"]);
  assert.deepEqual(sortSongs(rows, "score").map((r) => r.videoId), ["o", "s"]);
  assert.equal(isEvaluated(rows[0]), false);
  assert.equal(isEvaluated(rows[1]), true);
});
