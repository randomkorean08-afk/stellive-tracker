// Member playlists (data/playlists.json) -> 방송노래. Replaces clipper-channel collection and keyword search.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  reclassify, mergeEntries, mergePlaylistEntries, playlistAuto, parsePlaylistFeed, parsePlaylistItemsPage,
  fetchPlaylistViaApi, collectPlaylists, validatePlaylists, parsePlaylistsListResponse, fetchPlaylistsMeta, redactKey, coverageRow, formatCoverageLine, pickShortTargets, applyShortFormat, applyStatusAndAuthor,
} from "../lib/collector.mjs";
import { readJson, ROOT } from "./load.mjs";
import { parseArgs, resolveMembers } from "../scripts/add-clip.mjs";
import { REASON_LABELS } from "../app/dom.js";

const lock = readJson("data/channels-lock.json");
const seed = readJson("data/videos.json");
const NOW = "2026-11-23T00:00:00Z";
const chId = (key) => lock.channels.find((c) => c.key === key).channelId;
const src = (...p) => readFileSync(path.join(ROOT, ...p), "utf8");

const fan = (over = {}) => ({
  videoId: "ZZZZZZZZZZZ", title: "아카네 리제 - 만찬가 (晩餐歌)", publishedAt: "2026-11-20T00:00:00Z",
  ownerChannelId: "UCfanfanfanfanfanfanfan", playlistId: "PLfake", member: "akane-lize", ...over,
});

// ---------------------------------------------------------------- data/playlists.json

test("playlists.json: valid, 14 entries, member keys exist; clip-channels.json is gone", () => {
  const cfg = readJson("data/playlists.json");
  assert.equal(cfg.schemaVersion, 1);
  assert.equal(typeof cfg._note, "string");
  assert.equal(cfg.playlists.length, 14);
  const r = validatePlaylists(cfg, lock);
  assert.deepEqual(r.errors, []);
  assert.equal(r.valid.length, 14);
  const members = new Set(r.valid.map((p) => p.member));
  assert.equal(members.size, 12, "12 members (aokumo-rin and tenko-shibuki have two playlists each)");
  assert.ok(members.has("tokino-meri") && !members.has("tokino-mary"), "internal key is tokino-meri");
  assert.ok(!existsSync(path.join(ROOT, "data", "clip-channels.json")));
});

test("validatePlaylists: bad id / unknown member / duplicate are reported, ID length is not judged", () => {
  const r = validatePlaylists({ playlists: [
    { playlistId: "PLdUzWHjXdudE", member: "tokino-meri" }, // short ID stays valid (HTTP decides)
    { playlistId: "UCnotaplaylist", member: "akane-lize" },
    { playlistId: "PLabc", member: "nobody" },
    { playlistId: "PLdUzWHjXdudE", member: "tokino-meri" },
    { playlistId: "PLabc", member: "stellive" }, // group channel is not a member
  ] }, lock);
  assert.equal(r.valid.length, 1);
  assert.equal(r.errors.length, 4);
});

// ---------------------------------------------------------------- classification rules

test("rule a: a video already in videos.json is not touched by a playlist", () => {
  const official = Object.values(seed.videos).find((v) => v.channelKey && v.auto?.members?.length);
  const existing = { [official.videoId]: structuredClone(official) };
  const before = JSON.stringify(existing);
  const r = mergePlaylistEntries(existing, [
    { videoId: official.videoId, title: "다른 제목", publishedAt: "2026-01-01", ownerChannelId: "UCfanfanfanfanfanfanfan", playlistId: "PLx", member: "kogane-rang" },
  ], lock, NOW);
  assert.deepEqual(r.added, []);
  assert.equal(JSON.stringify(r.videos), before, "category/members/auto/title all untouched");
  assert.equal(JSON.stringify(existing), before, "input not mutated");
});

test("rule a: an existing 방송노래 from an earlier run stays as is when it shows up in another playlist", () => {
  const first = mergePlaylistEntries({}, [fan()], lock, NOW).videos;
  const again = mergePlaylistEntries(first, [fan({ playlistId: "PLother", member: "kogane-rang" })], lock, "2026-11-24T00:00:00Z");
  assert.deepEqual(again.videos.ZZZZZZZZZZZ, first.ZZZZZZZZZZZ);
  assert.deepEqual(again.added, []);
});

test("rule b: new video owned by an official channel is classified exactly like an official upload", () => {
  const inc = fan({ videoId: "AAAAAAAAAAA", title: "만찬가 / 아카네 리제 Cover", ownerChannelId: chId("akane-lize") });
  const r = mergePlaylistEntries({}, [inc], lock, NOW);
  const v = r.videos.AAAAAAAAAAA;
  assert.deepEqual(r.added, ["AAAAAAAAAAA"]);
  assert.equal(v.channelKey, "akane-lize");
  assert.deepEqual(v.seenOnChannels, ["akane-lize"]);
  assert.equal(v.auto.category, "solo_cover");
  assert.notEqual(v.auto.category, "stream_song");
  // identical to what the official RSS path would have produced
  const viaRss = mergeEntries({}, [{ videoId: "AAAAAAAAAAA", title: inc.title, channelKey: "akane-lize", publishedAt: inc.publishedAt, source: "rss" }], lock, NOW).videos.AAAAAAAAAAA;
  assert.deepEqual(v.auto, viaRss.auto);
  // and --reclassify-all keeps classifying it normally (not fixed)
  assert.equal(mergeEntries(r.videos, [], lock, NOW, { reclassifyAll: true }).videos.AAAAAAAAAAA.auto.category, "solo_cover");
});

test("rule c: fan upload -> fixed 방송노래 with the playlist member plus members named in the title", () => {
  const r = mergePlaylistEntries({}, [fan({ title: "[클립] 시라유키 히나 x 아라하시 타비 - 만찬가", member: "shirayuki-hina", playlistId: "PLhina" })], lock, NOW);
  const v = r.videos.ZZZZZZZZZZZ;
  assert.equal(v.source, "playlist");
  assert.equal(v.playlistId, "PLhina");
  assert.equal(v.channelKey, null);
  assert.equal(v.status, "unverified");
  assert.equal(v.auto.category, "stream_song");
  assert.deepEqual(v.auto.members, ["shirayuki-hina", "arahashi-tabi"], "lock order, no duplicates");
  assert.equal(v.auto.reviewRequired, false);
  assert.deepEqual(v.auto.matchedRules, ["P01-playlist-song"]);
});

test("rule c: title without any member name -> just the playlist's member, no review", () => {
  const v = mergePlaylistEntries({}, [fan({ title: "만찬가 (晩餐歌)", member: "tokino-meri" })], lock, NOW).videos.ZZZZZZZZZZZ;
  assert.deepEqual(v.auto.members, ["tokino-meri"]);
  assert.equal(v.auto.reviewRequired, false);
  assert.deepEqual(v.auto.reviewReasons, []);
});

test("rule c: the same new video in two playlists -> one entry, members of both playlists", () => {
  const r = mergePlaylistEntries({}, [
    fan({ title: "Silhouette cover", member: "tokino-meri", playlistId: "PL1" }),
    fan({ title: "Silhouette cover", member: "kogane-rang", playlistId: "PL2" }),
  ], lock, NOW);
  assert.deepEqual(r.added, ["ZZZZZZZZZZZ"]);
  assert.deepEqual(r.videos.ZZZZZZZZZZZ.auto.members, ["tokino-meri", "kogane-rang"]);
  assert.equal(r.videos.ZZZZZZZZZZZ.playlistId, "PL1");
});

test("reclassify keeps playlist 방송노래 fixed, also under --reclassify-all and after a title change", () => {
  const v = mergePlaylistEntries({}, [fan({ title: "토아 라이브 클립 cover", member: "shizuki-toa" })], lock, NOW).videos.ZZZZZZZZZZZ;
  assert.equal(v.auto.category, "stream_song");
  assert.deepEqual(reclassify(structuredClone(v), lock), v);
  const all = mergeEntries({ ZZZZZZZZZZZ: v }, [], lock, NOW, { reclassifyAll: true }).videos.ZZZZZZZZZZZ;
  assert.deepEqual(all.auto, v.auto);
  const renamed = mergeEntries({ ZZZZZZZZZZZ: v }, [{ videoId: "ZZZZZZZZZZZ", title: "3D live ver. 아카네 리제", channelKey: null, source: "rss" }], lock, NOW).videos.ZZZZZZZZZZZ;
  assert.equal(renamed.auto.category, "stream_song");
  assert.deepEqual(renamed.auto.members, ["shizuki-toa"]);
});

test("playlist attribution: three title cases + duet keeps both", () => {
  // 1) Title names another StelLive member, not the playlist member -> detected member(s) only
  const rinInLize = playlistAuto({ title: "정말 멋진 6월이었습니다(とても素敵な六月でした) (Eight) / 아오쿠모 린 Cover", publishedAt: null }, ["akane-lize"], lock);
  assert.equal(rinInLize.category, "stream_song");
  assert.deepEqual(rinInLize.members, ["aokumo-rin"]);
  const mergedOther = mergePlaylistEntries({}, [
    fan({ videoId: "LnjVkJA4Z7M", title: "정말 멋진 6월이었습니다(とても素敵な六月でした) (Eight) / 아오쿠모 린 Cover", member: "akane-lize", playlistId: "PLDrTKwLrFhOf9nTergtjGnb7TC6CpFzae" }),
  ], lock, NOW).videos.LnjVkJA4Z7M;
  assert.deepEqual(mergedOther.auto.members, ["aokumo-rin"]);

  // 2) Title names the playlist member (alone or with others) -> detected members
  const solo = playlistAuto({ title: "아카네 리제 - 만찬가 (晩餐歌)", publishedAt: null }, ["akane-lize"], lock);
  assert.deepEqual(solo.members, ["akane-lize"]);
  const duetWithPl = playlistAuto({ title: "아카네 리제 x 아오쿠모 린 - 만찬가 Cover", publishedAt: null }, ["akane-lize"], lock);
  assert.deepEqual(duetWithPl.members, ["akane-lize", "aokumo-rin"]);
  const duetWithoutPl = playlistAuto({ title: "시라유키 히나 x 아라하시 타비 - 만찬가", publishedAt: null }, ["akane-lize"], lock);
  assert.deepEqual(duetWithoutPl.members, ["shirayuki-hina", "arahashi-tabi"]);

  // 3) Title names no member -> [playlist member]
  const noName = playlistAuto({ title: "만찬가 (晩餐歌)", publishedAt: null }, ["akane-lize"], lock);
  assert.deepEqual(noName.members, ["akane-lize"]);
});

test("reclassify-all re-attributes saved playlist entries using playlists config; normal merge and missing playlistId stay unchanged", () => {
  const playlistsCfg = {
    playlists: [
      { playlistId: "PLDrTKwLrFhOf9nTergtjGnb7TC6CpFzae", member: "akane-lize" },
      { playlistId: "PLhina", member: "shirayuki-hina" },
    ],
  };
  // Saved pre-fix entry where Rin's cover in Lize's playlist had [akane-lize, aokumo-rin]
  const buggySaved = {
    videoId: "LnjVkJA4Z7M",
    title: "정말 멋진 6월이었습니다(とても素敵な六月でした) (Eight) / 아오쿠모 린 Cover",
    previousTitles: [],
    channelKey: null,
    seenOnChannels: [],
    publishedAt: "2026-11-20T00:00:00Z",
    source: "playlist",
    playlistId: "PLDrTKwLrFhOf9nTergtjGnb7TC6CpFzae",
    firstSeenAt: NOW,
    lastSeenInFeedAt: NOW,
    status: "active",
    statusCheckedAt: NOW,
    failStreak: 0,
    isShort: false,
    auto: { category: "stream_song", members: ["akane-lize", "aokumo-rin"], matchedRules: ["P01-playlist-song"], reviewRequired: false, reviewReasons: [] },
  };
  // Saved entry whose playlistId is no longer in playlistsCfg
  const orphanSaved = {
    ...structuredClone(buggySaved),
    videoId: "ORPHAN12345",
    playlistId: "PLremoved",
    auto: { category: "stream_song", members: ["akane-lize", "aokumo-rin"], matchedRules: ["P01-playlist-song"], reviewRequired: false, reviewReasons: [] },
  };
  // Saved entry with title naming no member
  const unnamedSaved = {
    ...structuredClone(buggySaved),
    videoId: "UNNAMED1234",
    title: "만찬가 (晩餐歌)",
    playlistId: "PLhina",
    auto: { category: "stream_song", members: ["shirayuki-hina"], matchedRules: ["P01-playlist-song"], reviewRequired: false, reviewReasons: [] },
  };

  // Without playlists config: reclassify and reclassifyAll keep entries fixed as before
  assert.deepEqual(reclassify(structuredClone(buggySaved), lock).auto.members, ["akane-lize", "aokumo-rin"]);
  assert.deepEqual(mergeEntries({ LnjVkJA4Z7M: buggySaved }, [], lock, NOW, { reclassifyAll: true }).videos.LnjVkJA4Z7M.auto.members, ["akane-lize", "aokumo-rin"]);

  // Normal merge (even with playlists config passed, reclassifyAll=false) never touches existing entries
  const normal = mergeEntries(
    { LnjVkJA4Z7M: buggySaved, ORPHAN12345: orphanSaved },
    [],
    lock,
    NOW,
    { reclassifyAll: false, playlists: playlistsCfg },
  );
  assert.deepEqual(normal.updated, []);
  assert.deepEqual(normal.videos.LnjVkJA4Z7M.auto.members, ["akane-lize", "aokumo-rin"]);
  const normalPl = mergePlaylistEntries(
    normal.videos,
    [fan({ videoId: "LnjVkJA4Z7M", title: buggySaved.title, member: "akane-lize", playlistId: "PLDrTKwLrFhOf9nTergtjGnb7TC6CpFzae" })],
    lock,
    NOW,
  );
  assert.deepEqual(normalPl.added, []);
  assert.deepEqual(normalPl.videos.LnjVkJA4Z7M.auto.members, ["akane-lize", "aokumo-rin"]);

  // reclassify with playlists config + reclassifyAll with playlists config re-attribute saved entries
  assert.deepEqual(reclassify(structuredClone(buggySaved), lock, { playlists: playlistsCfg }).auto.members, ["aokumo-rin"]);
  const all = mergeEntries(
    { LnjVkJA4Z7M: buggySaved, ORPHAN12345: orphanSaved, UNNAMED1234: unnamedSaved },
    [],
    lock,
    NOW,
    { reclassifyAll: true, playlists: playlistsCfg },
  );
  assert.deepEqual(all.updated, ["LnjVkJA4Z7M"]);
  assert.deepEqual(all.videos.LnjVkJA4Z7M.auto.members, ["aokumo-rin"]);
  assert.deepEqual(all.videos.ORPHAN12345.auto.members, ["akane-lize", "aokumo-rin"], "missing playlistId mapping stays unchanged");
  assert.deepEqual(all.videos.UNNAMED1234.auto.members, ["shirayuki-hina"]);
});

test("rule d: Shorts are excluded (title keyword, verified format, and the once-per-video format check covers them)", () => {
  assert.equal(playlistAuto({ title: "만찬가 #shorts", publishedAt: null }, ["akane-lize"], lock).category, "excluded_short");
  const v = mergePlaylistEntries({}, [fan({ title: "만찬가 (晩餐歌)" })], lock, NOW).videos.ZZZZZZZZZZZ;
  assert.deepEqual(pickShortTargets({ ZZZZZZZZZZZ: v }), ["ZZZZZZZZZZZ"], "new stream_song entry is format-checked");
  const short = applyShortFormat(v, true, lock);
  assert.equal(short.isShort, true);
  assert.equal(short.auto.category, "excluded_short");
  assert.equal(short.auto.reviewRequired, false);
  assert.deepEqual(pickShortTargets({ ZZZZZZZZZZZ: short }), [], "checked once");
  const long = applyShortFormat(v, false, lock);
  assert.equal(long.auto.category, "stream_song");
  assert.deepEqual(
    mergeEntries({ ZZZZZZZZZZZ: short }, [], lock, NOW, { reclassifyAll: true }).videos.ZZZZZZZZZZZ.auto.category, "excluded_short");
});

test("rule d: a full singing-stream VOD in a playlist is not listed as 방송노래", () => {
  assert.equal(playlistAuto({ title: "아카네 리제 노래방송 다시보기", publishedAt: null }, ["akane-lize"], lock).category, "excluded_stream");
});

test("playlist 방송노래 later resolved to an official channel by oEmbed is classified normally", () => {
  const v = mergePlaylistEntries({}, [fan({ title: "만찬가 / 아카네 리제 Cover", ownerChannelId: null })], lock, NOW).videos.ZZZZZZZZZZZ;
  assert.equal(v.auto.category, "stream_song");
  const next = applyStatusAndAuthor(v, { code: 200, authorUrl: `https://www.youtube.com/channel/${chId("akane-lize")}` }, lock, NOW);
  assert.equal(next.channelKey, "akane-lize");
  assert.equal(next.auto.category, "solo_cover");
});

// ---------------------------------------------------------------- parsing

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <yt:playlistId>PLdUzWHjXdudE</yt:playlistId>
 <yt:channelId>UC7xsnGjLzC6AhKKoVAHikIg</yt:channelId>
 <title>플레이리스트</title>
 <author><name>list owner</name><uri>https://www.youtube.com/channel/UC7xsnGjLzC6AhKKoVAHikIg</uri></author>
 <entry>
  <id>yt:video:HtCvLEe0WY4</id>
  <yt:videoId>HtCvLEe0WY4</yt:videoId>
  <yt:channelId>UCJy0HyRg47N3glFYmI47hrg</yt:channelId>
  <title>JANE DOE &amp; 米津玄師 | 토키노 메리 Live Cover</title>
  <author><name>메리마루</name><uri>https://www.youtube.com/channel/UCJy0HyRg47N3glFYmI47hrg</uri></author>
  <published>2026-11-21T13:31:33+00:00</published>
 </entry>
 <entry>
  <yt:videoId>a_b-c_d-e_f</yt:videoId>
  <title>author only</title>
  <author><name>x</name><uri>https://www.youtube.com/channel/UC_-aAbBcCdDeEfFgGhHiI_-</uri></author>
  <published>2026-11-20T00:00:00+00:00</published>
 </entry>
 <entry>
  <yt:videoId>BBBBBBBBBBB</yt:videoId>
  <title>no owner info</title>
  <published>2026-11-19T00:00:00+00:00</published>
 </entry>
 <entry><yt:videoId>bad id</yt:videoId><title>dropped</title></entry>
</feed>`;

test("RSS fallback parsing: owner from <yt:channelId> or <author><uri>, header ignored, bad IDs dropped", () => {
  const r = parsePlaylistFeed(ATOM);
  assert.deepEqual(r, [
    { videoId: "HtCvLEe0WY4", title: "JANE DOE & 米津玄師 | 토키노 메리 Live Cover", publishedAt: "2026-11-21T13:31:33+00:00", ownerChannelId: "UCJy0HyRg47N3glFYmI47hrg" },
    { videoId: "a_b-c_d-e_f", title: "author only", publishedAt: "2026-11-20T00:00:00+00:00", ownerChannelId: "UC_-aAbBcCdDeEfFgGhHiI_-" },
    { videoId: "BBBBBBBBBBB", title: "no owner info", publishedAt: "2026-11-19T00:00:00+00:00", ownerChannelId: null },
  ]);
});

const item = (id, title, over = {}) => ({
  snippet: { title, videoOwnerChannelId: "UCfanfanfanfanfanfanfan", publishedAt: "2026-11-22T00:00:00Z" },
  contentDetails: { videoId: id, videoPublishedAt: "2026-01-02T03:04:05Z" },
  status: { privacyStatus: "public" },
  ...over,
});
const PAGE1 = { nextPageToken: "TOKEN2", items: [
  item("AAAAAAAAAAA", "곡 1"),
  item("BBBBBBBBBBB", "Private video", { status: { privacyStatus: "private" } }),
  item("CCCCCCCCCCC", "Deleted video"),
  item("DDDDDDDDDDD", "숨김 제목", { status: { privacyStatus: "private" } }),
] };
const PAGE2 = { items: [item("EEEEEEEEEEE", "곡 2", { status: { privacyStatus: "unlisted" } })] };

test("API page parsing: private/deleted skipped, video publish date and owner used", () => {
  const p = parsePlaylistItemsPage(PAGE1);
  assert.deepEqual(p.entries, [{ videoId: "AAAAAAAAAAA", title: "곡 1", publishedAt: "2026-01-02T03:04:05Z", ownerChannelId: "UCfanfanfanfanfanfanfan" }]);
  assert.equal(p.nextPageToken, "TOKEN2");
  assert.equal(parsePlaylistItemsPage(PAGE2).nextPageToken, "");
});

const reply = (status, body, kind = "json") => ({ status, json: async () => body, text: async () => body });
const listItem = (id, itemCount, title = `제목 ${id}`) => ({ id, snippet: { title }, contentDetails: { itemCount } });
const LIST_ALL = { items: [listItem("PLfull", 3), listItem("PLshort", 3), listItem("PLnone", 3)] };

test("API pagination: follows nextPageToken, counts pages, asks for snippet,contentDetails,status", async () => {
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return reply(200, url.includes("pageToken=TOKEN2") ? PAGE2 : PAGE1); };
  const r = await fetchPlaylistViaApi("PLfake", "SECRETKEY", { fetchImpl });
  assert.equal(r.pages, 2);
  assert.deepEqual(r.entries.map((e) => e.videoId), ["AAAAAAAAAAA", "EEEEEEEEEEE"]);
  assert.match(urls[0], /part=snippet,contentDetails,status&maxResults=50&playlistId=PLfake/);
  assert.ok(!urls[0].includes("pageToken"));
  assert.match(urls[1], /pageToken=TOKEN2/);
});

test("API failure never leaks the key", async () => {
  const fetchImpl = async () => reply(403, {});
  await assert.rejects(fetchPlaylistViaApi("PLfake", "SECRETKEY", { fetchImpl }), (e) => e.message === "playlistItems HTTP 403" && !String(e.stack).includes("SECRETKEY"));
});

// ---------------------------------------------------------------- per-playlist error handling

test("a failing playlist logs one ERROR line and does not abort the others (RSS mode)", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("playlist_id=PLbad")) return reply(404, "");
    if (url.includes("playlist_id=PLboom")) throw new Error("network down");
    return reply(200, ATOM);
  };
  const logs = [];
  const r = await collectPlaylists([
    { playlistId: "PLbad", member: "kogane-rang" },
    { playlistId: "PLgood1", member: "tokino-meri" },
    { playlistId: "PLboom", member: "shizuki-toa" },
    { playlistId: "PLgood2", member: "hanayo-hiyori" },
  ], { fetchImpl, log: (s) => logs.push(s) });
  assert.equal(r.ok, 2);
  assert.equal(r.pages, 0);
  assert.equal(r.errors.length, 2);
  assert.deepEqual(logs, [
    "ERROR playlist PLbad (kogane-rang): playlist RSS HTTP 404",
    "ERROR playlist PLboom (shizuki-toa): network down",
  ]);
  assert.deepEqual([...new Set(r.incoming.map((e) => e.playlistId))], ["PLgood1", "PLgood2"]);
  assert.ok(r.incoming.every((e) => e.member && e.videoId));
});

test("with a key: API failure falls back to RSS (WARN); both failing -> ERROR; quota pages are counted", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("googleapis.com/youtube/v3/playlists?")) return reply(200, LIST_ALL);
    if (url.includes("googleapis.com")) {
      if (url.includes("playlistId=PLshort")) return reply(404, {});
      if (url.includes("playlistId=PLnone")) return reply(404, {});
      return reply(200, url.includes("pageToken=TOKEN2") ? PAGE2 : PAGE1);
    }
    return url.includes("playlist_id=PLnone") ? reply(404, "") : reply(200, ATOM);
  };
  const logs = [];
  const r = await collectPlaylists([
    { playlistId: "PLfull", member: "akane-lize" },
    { playlistId: "PLshort", member: "tokino-meri" },
    { playlistId: "PLnone", member: "kogane-rang" },
  ], { apiKey: "SECRETKEY", fetchImpl, log: (s) => logs.push(s) });
  assert.equal(r.pages, 2 + 1 + 1, "2 pages + two failed single calls");
  assert.equal(r.metaCalls, 1, "one playlists.list call for all ids");
  assert.equal(r.ok, 2);
  assert.deepEqual(logs, [
    "WARN playlist PLshort (tokino-meri): playlistItems HTTP 404; trying RSS fallback",
    "WARN playlist PLnone (kogane-rang): playlistItems HTTP 404; trying RSS fallback",
    "ERROR playlist PLnone (kogane-rang): playlistItems HTTP 404; playlist RSS HTTP 404",
  ]);
  assert.ok(logs.every((l) => !l.includes("SECRETKEY")));
  assert.equal(r.incoming.filter((e) => e.playlistId === "PLfull").length, 2);
  assert.equal(r.incoming.filter((e) => e.playlistId === "PLshort").length, 3);
});

// ---------------------------------------------------------------- review follow-ups

const EXPECTED_PLAYLISTS = {
  "PLDrTKwLrFhOf9nTergtjGnb7TC6CpFzae": "akane-lize",
  "PLkpE8OHnsYszCTHPI9Qual0EAKuwE7gu-": "arahashi-tabi",
  "PLkTfHUsbPfKW2cDW6jBPvltEXleOWo1ji": "shirayuki-hina",
  "PLkpE8OHnsYsw0qfl6F3a37hYqYACI93B-": "neneko-mashiro",
  "PLBHBs3cCXwbRm_I-iGgyOyOIFbKZHw41_": "yuzuha-riko",
  "PLS_hcZPw0OSX8exQiAc3E03vFjnpOvoBh": "aokumo-rin",
  "PLxXdp-Ka6v4f0_kX4lkqNIOAJ6i0FcW67": "aokumo-rin",
  "PLpnXmaljWC7OYKuR4NDkFXIJ_HddLplt2": "tenko-shibuki",
  "PLIEEZFchbPfo7mcT2gJZErPkmX4K0gAFd": "tenko-shibuki",
  "PLv3H3C09yvpgRGSqTDSWGSERzlrFRw_Qb": "hanako-nana",
  "PLdUzWHjXdudE": "tokino-meri",
  "PLaWgFzmpw2bQ": "shizuki-toa",
  "PLWq_FnYQsJmM": "kogane-rang",
  "PLFlLdtTq_r_U": "hanayo-hiyori",
};

test("data/playlists.json: exact playlistId -> member map; rssOnly mechanism is gone", () => {
  const cfg = readJson("data/playlists.json");
  assert.deepEqual(Object.fromEntries(cfg.playlists.map((p) => [p.playlistId, p.member])), EXPECTED_PLAYLISTS);
  assert.equal(cfg.playlists.length, 14);
  assert.ok(cfg.playlists.every((p) => !("rssOnly" in p)), "no rssOnly flag on any entry");
  assert.ok(!/rssOnly/.test(readFileSync(path.join(ROOT, "data", "playlists.json"), "utf8")));
  assert.ok(validatePlaylists(cfg, lock).valid.every((p) => !("rssOnly" in p)));
  for (const f of [["lib", "collector.mjs"], ["scripts", "fetch-videos.mjs"], ["docs", "schema.md"]]) {
    assert.ok(!/rssOnly|RSS-only \(latest/.test(src(...f)), f.join("/"));
  }
});

test("review 1: official-looking playlist uploads (original / live_special) wait in the review queue as stream_song", () => {
  for (const [title, member] of [
    ["Miiro 「목숨」 feat. 아카네 리제 OFFICIAL MV", "akane-lize"],
    ["코가네 랑 이누야샤 ost - 시대를 초월한 마음 (flute)", "kogane-rang"],
    ["아카네 리제 3D live stage - 만찬가", "akane-lize"],
  ]) {
    const a = playlistAuto({ title, publishedAt: null }, [member], lock);
    assert.equal(a.category, "stream_song", title);
    assert.equal(a.reviewRequired, true, title);
    assert.deepEqual(a.reviewReasons, ["playlist_official_candidate"], title);
    assert.ok(a.members.includes(member));
  }
  const v = mergePlaylistEntries({}, [fan({ title: "Miiro 「목숨」 feat. 아카네 리제 OFFICIAL MV" })], lock, NOW).videos.ZZZZZZZZZZZ;
  assert.equal(v.auto.reviewRequired, true);
  assert.deepEqual(reclassify(structuredClone(v), lock).auto, v.auto, "stays fixed (no auto-promotion)");
  const plain = playlistAuto({ title: "만찬가 / 아카네 리제 Cover", publishedAt: null }, ["akane-lize"], lock);
  assert.equal(plain.reviewRequired, false);
});

test("review 2: title with whole tokens 방송 + 풀버전 -> review (playlist_full_stream_candidate)", () => {
  const a = playlistAuto({ title: "[방송] 아카네 리제 풀버전", publishedAt: null }, ["akane-lize"], lock);
  assert.equal(a.category, "stream_song");
  assert.equal(a.reviewRequired, true);
  assert.deepEqual(a.reviewReasons, ["playlist_full_stream_candidate"]);
  for (const t of ["아카네 리제 풀버전", "아카네 리제 방송 중 한 곡", "아카네 리제 방송용 풀버전", "아카네 리제 오늘방송 풀버전"]) {
    assert.deepEqual(playlistAuto({ title: t, publishedAt: null }, ["akane-lize"], lock).reviewReasons, [], t);
  }
  const both = playlistAuto({ title: "방송 풀버전 OFFICIAL MV", publishedAt: null }, ["akane-lize"], lock);
  assert.deepEqual(both.reviewReasons, ["playlist_official_candidate", "playlist_full_stream_candidate"]);
  assert.equal(playlistAuto({ title: "노래방송 풀버전", publishedAt: null }, ["akane-lize"], lock).category, "excluded_stream", "R20 keywords still exclude");
});

test("review 1+2: both reasons have Korean labels in the review UI", () => {
  for (const k of ["playlist_official_candidate", "playlist_full_stream_candidate"]) assert.match(REASON_LABELS[k], /[가-힣]/, k);
});

test("review 3: videos owned by a collect:none channel (stellive-topic) are skipped, not added", () => {
  const topic = lock.channels.find((c) => c.key === "stellive-topic");
  assert.equal(topic.collect, "none");
  const r = mergePlaylistEntries({}, [
    fan({ videoId: "TTTTTTTTTTT", title: "아카네 리제 - 만찬가 Cover", ownerChannelId: topic.channelId }),
    fan({ videoId: "AAAAAAAAAAA", title: "만찬가 / 아카네 리제 Cover", ownerChannelId: chId("akane-lize") }),
  ], lock, NOW);
  assert.deepEqual(r.added, ["AAAAAAAAAAA"]);
  assert.ok(!("TTTTTTTTTTT" in r.videos));
});

test("every playlist (short IDs included) tries playlistItems.list first when a key exists; RSS only after an API failure", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("googleapis.com/youtube/v3/playlists?")) return reply(200, { items: ["PLdUzWHjXdudE", "PLaWgFzmpw2bQ", "PLfull"].map((id) => listItem(id, 3)) });
    if (url.includes("googleapis.com")) return url.includes("playlistId=PLaWgFzmpw2bQ") ? reply(404, {}) : reply(200, PAGE2);
    return reply(200, ATOM);
  };
  const logs = [];
  const r = await collectPlaylists([
    { playlistId: "PLfull", member: "akane-lize" },
    { playlistId: "PLdUzWHjXdudE", member: "tokino-meri" },
    { playlistId: "PLaWgFzmpw2bQ", member: "shizuki-toa" },
  ], { apiKey: "SECRETKEY", fetchImpl, log: (s) => logs.push(s) });
  assert.equal(calls.filter((u) => u.includes("googleapis.com/youtube/v3/playlistItems")).length, 3, "all three tried the API");
  assert.equal(calls.filter((u) => u.includes("feeds/videos.xml")).length, 1, "only the failing one used RSS");
  assert.deepEqual(logs, ["WARN playlist PLaWgFzmpw2bQ (shizuki-toa): playlistItems HTTP 404; trying RSS fallback"]);
  assert.equal(r.pages, 3);
  assert.equal(r.metaCalls, 1);
  assert.equal(r.ok, 3);
});

// ---------------------------------------------------------------- coverage (playlists.list itemCount)

test("parsePlaylistsListResponse: id -> {itemCount,title}; junk tolerated", () => {
  const r = parsePlaylistsListResponse({ items: [
    { id: "PLa", snippet: { title: "A 목록" }, contentDetails: { itemCount: 120 } },
    { id: "PLb", snippet: {}, contentDetails: {} },
    { snippet: { title: "no id" } },
    { id: "", contentDetails: { itemCount: 1 } },
  ] });
  assert.deepEqual(r, { PLa: { itemCount: 120, title: "A 목록" }, PLb: { itemCount: null, title: "" } });
  assert.deepEqual(parsePlaylistsListResponse({}), {});
  assert.deepEqual(parsePlaylistsListResponse(null), {});
});

test("fetchPlaylistsMeta: one call for <=50 ids, chunks of 50, comma-joined ids, key never in errors", async () => {
  const urls = [];
  const ids = Array.from({ length: 120 }, (_, i) => `PL${String(i).padStart(3, "0")}`);
  const fetchImpl = async (url) => {
    urls.push(url);
    const q = new URL(url).searchParams.get("id").split(",");
    return reply(200, { items: q.map((id) => listItem(id, 7)) });
  };
  const r = await fetchPlaylistsMeta([...ids, ids[0]], "SECRETKEY", { fetchImpl });
  assert.equal(r.calls, 3, "120 unique ids -> 50 + 50 + 20");
  assert.equal(Object.keys(r.meta).length, 120);
  assert.match(urls[0], /^https:\/\/www\.googleapis\.com\/youtube\/v3\/playlists\?part=contentDetails,snippet&id=PL000,PL001,/);
  assert.equal(new URL(urls[0]).searchParams.get("id").split(",").length, 50);
  assert.equal((await fetchPlaylistsMeta(ids.slice(0, 14), "K", { fetchImpl })).calls, 1);
  await assert.rejects(fetchPlaylistsMeta(["PLa"], "SECRETKEY", { fetchImpl: async () => reply(403, {}) }),
    (e) => e.message === "playlists.list HTTP 403" && e.calls === 1 && !String(e.stack).includes("SECRETKEY"));
});

test("redactKey + collectPlaylists: an error message containing the key is logged/returned as [REDACTED]", async () => {
  assert.equal(redactKey("boom key=SECRETKEY&x SECRETKEY", "SECRETKEY"), "boom key=[REDACTED]&x [REDACTED]");
  assert.equal(redactKey("a b/c", "a b/c"), "[REDACTED]");
  assert.equal(redactKey("k=a%20b%2Fc", "a b/c"), "k=[REDACTED]", "URL-encoded form too");
  assert.equal(redactKey("no key here", ""), "no key here");
  const KEY = "AIzaSECRETKEY123";
  const fetchImpl = async (url) => { throw new Error(`request to ${url} failed`); }; // url contains the key
  await assert.rejects(fetchPlaylistViaApi("PLx", KEY, { fetchImpl }), (e) => e.message.includes("[REDACTED]") && !e.message.includes(KEY) && !e.stack.includes(KEY));
  await assert.rejects(fetchPlaylistsMeta(["PLx"], KEY, { fetchImpl }), (e) => e.message.includes("[REDACTED]") && !e.message.includes(KEY) && !e.stack.includes(KEY));
  const logs = [];
  const r = await collectPlaylists([{ playlistId: "PLx", member: "akane-lize" }], {
    apiKey: KEY, log: (s) => logs.push(s),
    fetchImpl: async (url) => { if (url.includes("googleapis.com")) throw new Error(`socket hang up ${url}`); throw new Error(`rss down key=${KEY}`); },
  });
  const all = [...logs, ...r.errors].join(" | ");
  assert.ok(all.includes("[REDACTED]"), all);
  assert.ok(!all.includes(KEY) && !all.includes(encodeURIComponent(KEY)), all);
  assert.equal(r.errors.length, 1);
});

test("coverageRow / formatCoverageLine: ok, private-skipped, gap, RSS limit, failed", () => {
  const base = { playlistId: "PLa", member: "akane-lize" };
  const ok = coverageRow({ ...base, via: "api", returned: 100, meta: { itemCount: 100, title: "목록" } });
  assert.equal(ok.status, "ok");
  assert.equal(formatCoverageLine(ok, 90), 'coverage PLa (akane-lize) "목록": collected 100 / total 100 via api (90 in videos.json)');
  const priv = coverageRow({ ...base, via: "api", returned: 98, skipped: 2, meta: { itemCount: 100, title: "" } });
  assert.equal(priv.status, "ok", "private/deleted items explain the difference");
  assert.equal(formatCoverageLine(priv), "coverage PLa (akane-lize): collected 98 / total 100 via api (2 private/deleted skipped)");
  const gap = coverageRow({ ...base, via: "api", returned: 90, skipped: 2, meta: { itemCount: 100, title: "" } });
  assert.equal(gap.status, "gap");
  assert.equal(formatCoverageLine(gap), "WARN coverage PLa (akane-lize): collected 90 / total 100 via api (2 private/deleted skipped) GAP: 8 missing");
  const rss = coverageRow({ ...base, via: "rss", returned: 15, meta: { itemCount: 120, title: "" } });
  assert.equal(formatCoverageLine(rss), "WARN coverage PLa (akane-lize): collected 15 / total 120 via rss GAP: 105 missing (RSS limit ~15 items)");
  assert.equal(coverageRow({ ...base, via: "rss", returned: 15, meta: null }).status, "ok", "unknown total (no key) is informational, not a WARN");
  assert.equal(formatCoverageLine(coverageRow({ ...base, via: "rss", returned: 15, meta: null })), "coverage PLa (akane-lize): collected 15 / total ? via rss");
  assert.equal(coverageRow({ ...base, via: "api", returned: 15, meta: null }).status, "ok", "API without totals (playlists.list failed) is not flagged");
  const failed = coverageRow({ ...base, via: "failed", returned: 0, meta: { itemCount: 5, title: "" } });
  assert.equal(formatCoverageLine(failed), "ERROR coverage PLa (akane-lize): collection failed (0 / 5)");
});

test("collectPlaylists coverage: totals from playlists.list, ERROR for ids it does not return, no URL/key in logs", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("googleapis.com/youtube/v3/playlists?")) return reply(200, { items: [listItem("PLfull", 5, "전체"), listItem("PLgood", 3)] });
    if (url.includes("playlistId=PLfull")) return reply(200, url.includes("pageToken=TOKEN2") ? PAGE2 : PAGE1);
    if (url.includes("playlistId=PLgood")) return reply(200, { items: [item("GGGGGGGGGGG", "곡"), item("HHHHHHHHHHH", "곡"), item("IIIIIIIIIII", "곡")] });
    if (url.includes("googleapis.com")) return reply(404, {}); // PLghost: invalid id
    return url.includes("playlist_id=PLghost") ? reply(404, "") : reply(200, ATOM);
  };
  const logs = [];
  const r = await collectPlaylists([
    { playlistId: "PLfull", member: "akane-lize" },
    { playlistId: "PLgood", member: "tokino-meri" },
    { playlistId: "PLghost", member: "kogane-rang" },
  ], { apiKey: "SECRETKEY", fetchImpl, log: (s) => logs.push(s) });
  assert.deepEqual(logs, [
    "ERROR playlist PLghost (kogane-rang): not returned by playlists.list (invalid, private or deleted playlist)",
    "WARN playlist PLghost (kogane-rang): playlistItems HTTP 404; trying RSS fallback",
    "ERROR playlist PLghost (kogane-rang): playlistItems HTTP 404; playlist RSS HTTP 404",
  ]);
  assert.ok(logs.every((l) => !l.includes("SECRETKEY") && !l.includes("googleapis")));
  assert.equal(r.coverage.length, 3);
  const [full, good, ghost] = r.coverage;
  // PAGE1: 1 usable + 3 private/deleted, PAGE2: 1 usable -> 2 returned, 3 skipped vs total 5
  assert.deepEqual([full.returned, full.skipped, full.total, full.title, full.status, full.via], [2, 3, 5, "전체", "ok", "api"]);
  assert.deepEqual([good.returned, good.total, good.status], [3, 3, "ok"]);
  assert.deepEqual([ghost.via, ghost.status, ghost.total], ["failed", "error", null]);
  assert.equal(r.errors.length, 2, "missing-from-list and collection failure are both reported");
  assert.equal(r.metaCalls, 1);
});

test("collectPlaylists coverage: playlists.list failure is a WARN, collection still runs; no key -> no meta call", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("googleapis.com/youtube/v3/playlists?")) return reply(403, {});
    return reply(200, PAGE2);
  };
  const logs = [];
  const r = await collectPlaylists([{ playlistId: "PLfull", member: "akane-lize" }], { apiKey: "SECRETKEY", fetchImpl, log: (s) => logs.push(s) });
  assert.deepEqual(logs, ["WARN playlists.list failed: playlists.list HTTP 403; coverage totals unavailable"]);
  assert.equal(r.ok, 1);
  assert.equal(r.metaCalls, 1);
  assert.deepEqual([r.coverage[0].returned, r.coverage[0].total, r.coverage[0].status], [1, null, "ok"]);
  urls.length = 0;
  const rss = await collectPlaylists([{ playlistId: "PLfull", member: "akane-lize" }], { fetchImpl: async (u) => { urls.push(u); return reply(200, ATOM); }, log: () => {} });
  assert.ok(urls.every((u) => u.includes("feeds/videos.xml")));
  assert.equal(rss.metaCalls, 0);
  assert.deepEqual([rss.coverage[0].via, rss.coverage[0].total, rss.coverage[0].status], ["rss", null, "ok"]);
});

test("PLS_hc (aokumo-rin) has no playlist-sourced entries: its newest items are all official-channel videos already collected", () => {
  // (videos.json changes hourly, so only the stable part is asserted: these ids never become playlist-sourced.)
  // 15 newest RSS items (checked 2026-11-24): every one already exists under rss/backfill/seed with an official channelKey.
  const known = ["qNOFi7GzpfM", "LmOl01G4DR4", "JLM7z8afU4s", "Qi_JLmXBFFo", "qv_VVUJOt0M", "9S3if_u5n_Q", "MhdJaaEhiHc", "ZYSQLv_L26Y",
    "_g29-2fUPSA", "y1nUYj_D1Es", "pgxzbTzvYdY", "tZQOhC9Ktas", "So0ba8NuUq0", "aACJnJRuCLs", "GhHcaH6bAHQ"];
  for (const v of known) assert.ok(seed.videos[v] && seed.videos[v].source !== "playlist" && seed.videos[v].channelKey, v);
});

// ---------------------------------------------------------------- removed code paths / regex sanity

test("clip-channel collection and keyword search are gone (code, workflow, exports)", async () => {
  const gone = /clipAuto|namesStelliveMember|clipChannel|clipMode|searchQuery|search-clips|search_clips|searchRecentClips|CLIP_CHANNELS_PATH|clip-channels|search\.list/;
  for (const f of [["scripts", "fetch-videos.mjs"], ["lib", "collector.mjs"], ["scripts", "add-clip.mjs"]]) {
    assert.ok(!gone.test(src(...f)), f.join("/"));
  }
  const collector = await import("../lib/collector.mjs");
  assert.equal(collector.clipAuto, undefined);
  assert.equal(collector.namesStelliveMember, undefined);
  const wf = src(".github", "workflows", "fetch-videos.yml");
  assert.match(wf, /cron: "0 \* \* \* \*"/, "hourly cron kept");
  assert.equal((wf.match(/cron:/g) ?? []).length, 1, "only the hourly cron");
  assert.ok(!/search_clips|SEARCH_CLIPS|SCHEDULE|30 0 \* \* \*|--search-clips/.test(wf));
  assert.match(wf, /--force-views/);
  assert.match(wf, /--longform-feed/);
});

test("fetch script reads data/playlists.json (read-only) and its regexes are not mangled", () => {
  const s = src("scripts", "fetch-videos.mjs");
  assert.match(s, /PLAYLISTS_PATH = path\.join\(ROOT, "data", "playlists\.json"\)/);
  assert.match(s, /readJson\(PLAYLISTS_PATH\)/);
  assert.ok(s.includes('.replace(/\\.\\d{3}Z$/, "Z")'), "timestamp trim regex intact");
  assert.ok(!s.includes("/.d{3}Z$/"));
  const c = src("lib", "collector.mjs");
  for (const lit of ["/^PL[\\w-]+$/", "(UC[\\w-]{22})", "/<yt:channelId>\\s*(UC[\\w-]{22})\\s*<\\/yt:channelId>/", "\\/channel\\/(UC[\\w-]{22})(?![\\w-])"]) {
    assert.ok(c.includes(lit), `collector keeps ${lit}`);
  }
  assert.ok(!c.includes("[w-]"), "no lost backslash in a character class");
});

// ---------------------------------------------------------------- kept from the old clip tests

test("classify: spaceless full names (토키노메리) are detected as members", async () => {
  const { classify } = await import("../lib/classify.mjs");
  const r = classify({ title: "[싱크룸/어비스] 토키노메리 × 코가네 랑 × 시즈키 토아 × 하나요 히요리 - 실루엣", channelKey: null, publishedAt: "2026-11-01" }, lock);
  assert.ok(r.members.includes("tokino-meri"));
});

test("add-clip: URL after --members is not swallowed; 11-char member keys stay members", () => {
  const o = parseArgs(["--members", "아카네", "리제", "https://youtu.be/ZZZZZZZZZZZ"]);
  assert.equal(o.target, "https://youtu.be/ZZZZZZZZZZZ");
  assert.deepEqual(resolveMembers(o.members, lock), ["akane-lize"]);
  const k = parseArgs(["ZZZZZZZZZZZ", "--members", "kogane-rang"]);
  assert.equal(k.target, "ZZZZZZZZZZZ");
  assert.deepEqual(resolveMembers(k.members, lock), ["kogane-rang"]);
});
