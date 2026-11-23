// Member playlists (data/playlists.json) -> 방송노래. Replaces clipper-channel collection and keyword search.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  reclassify, mergeEntries, mergePlaylistEntries, playlistAuto, parsePlaylistFeed, parsePlaylistItemsPage,
  fetchPlaylistViaApi, collectPlaylists, validatePlaylists, pickShortTargets, applyShortFormat, applyStatusAndAuthor,
} from "../lib/collector.mjs";
import { readJson, ROOT } from "./load.mjs";
import { parseArgs, resolveMembers } from "../scripts/add-clip.mjs";

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
