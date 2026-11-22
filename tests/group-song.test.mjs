// 단체곡 (다인원 단체곡·합창곡): listed everywhere, counted in slots, but never vocally evaluated (B).
import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP_SONG_MIN_MEMBERS, isGroupSong, deriveAll } from "../lib/derive.mjs";
import { sortSongs } from "../lib/song-search.mjs";
import { readJson, clone } from "./load.mjs";

const channels = readJson("data/channels-lock.json");
const videos = readJson("data/videos.json");
const ratings = readJson("data/ratings.json");
const overrides = readJson("data/overrides.json");
const baseline = readJson("data/baseline/baseline-2026-11-17.json");
const run = (over = {}) => deriveAll({ channels, videos, overrides, ratings, baseline, ...over });

test("threshold: 3+ effective members is a group song; duets are still evaluated", () => {
  assert.equal(GROUP_SONG_MIN_MEMBERS, 3);
  assert.equal(isGroupSong(["a", "b"]), false);
  assert.equal(isGroupSong(["a", "b", "c"]), true);
  assert.equal(isGroupSong([]), false);
});

test("STAR TRAIL (9 members) stays listed with its rating preserved, flagged groupSong", () => {
  const d = run();
  const st = d.videoRows.find((r) => r.videoId === "v094-E3Pmtk");
  assert.equal(st.counted, true, "still shown in archive/search/viewer");
  assert.equal(st.groupSong, true);
  assert.equal(st.songScore, 96.8, "ratings.json value untouched");
  assert.equal(d.videoRows.find((r) => r.videoId === "EIii4EXsfsU").groupSong, false, "duet");
});

test("group songs do not affect any member's B average, rated count or B rank", () => {
  const d = run();
  const groupIds = d.videoRows.filter((r) => r.groupSong).map((r) => r.videoId);
  assert.ok(groupIds.includes("v094-E3Pmtk") && groupIds.includes("Ei7yWYi7x_E"));
  const v2 = clone(videos);
  v2.videos = Object.fromEntries(Object.entries(v2.videos).filter(([id]) => !groupIds.includes(id)));
  const d2 = run({ videos: v2 });
  for (const c of d.memberCards) {
    const c2 = d2.memberCards.find((x) => x.key === c.key);
    assert.equal(c.songAvg, c2.songAvg, c.key);
    assert.equal(c.songAvgN, c2.songAvgN, c.key);
    assert.equal(c.rankB, c2.rankB, c.key);
  }
  const lize = d.memberCards.find((c) => c.key === "akane-lize");
  assert.ok(lize.groupSongCount >= 1, "group songs are counted separately");
  assert.ok(lize.slots.total > d2.memberCards.find((c) => c.key === "akane-lize").slots.total, "still counted in slots");
});

test("score sort treats group songs as unscored", () => {
  const rows = [
    { videoId: "g", publishedAt: "2026-01-01", songScore: 99, groupSong: true },
    { videoId: "s", publishedAt: "2025-01-01", songScore: 90, groupSong: false },
  ];
  assert.deepEqual(sortSongs(rows, "score").map((r) => r.videoId), ["s", "g"]);
});
