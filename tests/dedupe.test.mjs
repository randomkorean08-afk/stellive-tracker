import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeVideoId } from "../lib/video-id.mjs";
import {
  mergeEntries, applyStatusResult, applyStatusAndAuthor, parseAtomFeed, serializeVideosDoc,
  videosEqual, pickStatusTargets, checkOembed, channelKeyFromAuthorUrl,
} from "../lib/collector.mjs";
import { deriveAll } from "../lib/derive.mjs";
import { readJson, clone } from "./load.mjs";

const lock = readJson("data/channels-lock.json");
const seed = readJson("data/videos.json");
const ratings = readJson("data/ratings.json");
const overrides = readJson("data/overrides.json");
const baseline = readJson("data/baseline/baseline-2026-11-17.json");
const fx = readJson("tests/fixtures/dedupe-cases.json");
const NOW = "2026-11-20T03:17:00Z";

const existingOf = (ids) => Object.fromEntries(ids.map((id) => [id, clone(seed.videos[id])]));

for (const [i, c] of fx.normalizeVideoId.entries()) {
  test(`normalizeVideoId #${i} ${JSON.stringify(c.in)}`, () => assert.equal(normalizeVideoId(c.in), c.out));
}

test("normalizeVideoId rejects non-strings and foreign hosts", () => {
  assert.equal(normalizeVideoId(null), null);
  assert.equal(normalizeVideoId("https://example.com/watch?v=R_B4tmy2DVA"), null);
});

const ratingsBefore = JSON.stringify(ratings);

for (const c of fx.merge) {
  if (c.oembedSequence) continue;
  test(`merge ${c.id}`, () => {
    const existing = existingOf(c.existing);
    const frozenKeys = Object.keys(existing);
    const incoming = (c.incoming ?? []).map((e) => ({ ...e, publishedAt: "2026-11-19T00:00:00+00:00", source: "rss" }));
    const r = mergeEntries(existing, incoming, lock, NOW);
    const e = c.expect;
    if (e.added) assert.deepEqual(r.added, e.added);
    if (e.updated) assert.deepEqual(r.updated, e.updated);
    if (e.totalAfter !== undefined) assert.equal(Object.keys(r.videos).length, e.totalAfter);
    if (e.previousTitlesContains) assert.ok(r.videos[c.incoming[0].videoId].previousTitles.includes(e.previousTitlesContains));
    if (e.seenOnChannels) assert.deepEqual(r.videos[c.incoming[0].videoId].seenOnChannels, e.seenOnChannels);
    if (e.statusAfter) for (const id of Object.keys(e.statusAfter)) assert.equal(r.videos[id].status, existing[id].status);
    assert.deepEqual(Object.keys(existing), frozenKeys, "input not mutated");
    // all pre-existing entries survive
    for (const id of c.existing) assert.ok(id in r.videos);

    if (c.id === "M08-new-video-unrated") {
      const base = deriveAll({ channels: lock, videos: seed, overrides, ratings, baseline });
      const vids = { ...seed, videos: { ...seed.videos, ...r.videos } };
      const after = deriveAll({ channels: lock, videos: vids, overrides, ratings, baseline });
      const card = (d, k) => d.memberCards.find((m) => m.key === k);
      for (const k of ["akane-lize", "tokino-meri"]) {
        assert.equal(card(after, k).rubricTotal, card(base, k).rubricTotal);
        assert.equal(card(after, k).songAvg, card(base, k).songAvg);
        assert.equal(card(after, k).rankA, card(base, k).rankA);
        assert.equal(card(after, k).rankB, card(base, k).rankB);
      }
      assert.equal(card(after, "akane-lize").slots.solo_cover, card(base, "akane-lize").slots.solo_cover + e.deriveSlotsDelta["akane-lize"].solo_cover);
    }
  });
}

test("merge never touches ratings.json content (ratings object untouched)", () => {
  assert.equal(JSON.stringify(readJson("data/ratings.json")), ratingsBefore);
});

for (const c of fx.merge.filter((m) => m.oembedSequence)) {
  test(`status ${c.id}`, () => {
    let entry = clone(seed.videos[c.existing[0]]);
    const steps = c.oembedSequence.map((code) => (entry = applyStatusResult(entry, { code }, NOW)));
    if (c.expect.afterFirst) {
      assert.equal(steps[0].status, c.expect.afterFirst.status);
      assert.equal(steps[0].failStreak, c.expect.afterFirst.failStreak);
    }
    assert.equal(steps[1].status, c.expect.afterSecond.status);
    assert.equal(steps[1].failStreak, c.expect.afterSecond.failStreak);
    if (c.expect.entryKept) assert.ok(steps[1].videoId);
  });
}

test("status: 401/403 -> private after 2; 5xx / network error -> no change", () => {
  let e = clone(seed.videos["kNzGpNEdBqw"]);
  e = applyStatusResult(e, { code: 403 }, NOW);
  assert.equal(e.status, "unverified");
  e = applyStatusResult(e, { code: 401 }, NOW);
  assert.equal(e.status, "private");
  const same = applyStatusResult(e, { code: 503 }, "2030-01-01T00:00:00Z");
  assert.deepEqual(same, e);
  const same2 = applyStatusResult(e, { error: "network" }, "2030-01-01T00:00:00Z");
  assert.deepEqual(same2, e);
});

test("status fills null channelKey only via locked handle", () => {
  const l = clone(lock);
  l.channels.find((c) => c.key === "shirayuki-hina").handle = "@HinaChannel";
  const entry = clone(seed.videos["EIii4EXsfsU"]);
  assert.equal(entry.channelKey, null);
  const filled = applyStatusAndAuthor(entry, { code: 200, authorUrl: "https://www.youtube.com/@hinachannel" }, l, NOW);
  assert.equal(filled.channelKey, "shirayuki-hina");
  const unknown = applyStatusAndAuthor(entry, { code: 200, authorUrl: "https://www.youtube.com/@someoneelse" }, l, NOW);
  assert.equal(unknown.channelKey, null);
  assert.equal(channelKeyFromAuthorUrl("https://www.youtube.com/@hinachannel", lock), null, "no handle in lock -> no match");
});

test("pickStatusTargets: null first, oldest first, limit, recheck window", () => {
  const v = {
    a: { videoId: "a", statusCheckedAt: null, status: "unverified", failStreak: 0 },
    b: { videoId: "b", statusCheckedAt: "2026-11-01T00:00:00Z", status: "active", failStreak: 0 },
    c: { videoId: "c", statusCheckedAt: "2026-10-01T00:00:00Z", status: "active", failStreak: 0 },
    d: { videoId: "d", statusCheckedAt: "2026-11-20T01:00:00Z", status: "active", failStreak: 0 },
  };
  assert.deepEqual(pickStatusTargets(v, { limit: 2, now: NOW }), ["a", "c"]);
  assert.deepEqual(pickStatusTargets(v, { limit: 10, now: NOW }), ["a", "c", "b"]);
});

test("checkOembed uses injected fetch (no network)", async () => {
  const urls = [];
  const fake = async (url) => {
    urls.push(url);
    return { status: 200, json: async () => ({ author_name: "X", author_url: "https://www.youtube.com/@x" }) };
  };
  const r = await checkOembed("R_B4tmy2DVA", { fetchImpl: fake });
  assert.deepEqual(r, { code: 200, authorName: "X", authorUrl: "https://www.youtube.com/@x" });
  assert.ok(urls[0].includes("oembed") && urls[0].includes("R_B4tmy2DVA"));
  const err = await checkOembed("R_B4tmy2DVA", { fetchImpl: async () => { throw new Error("boom"); } });
  assert.ok(err.error);
});

test("parseAtomFeed decodes entities and ignores media:title", () => {
  const xml = `<feed><entry><id>yt:video:R_B4tmy2DVA</id><yt:videoId>R_B4tmy2DVA</yt:videoId>
    <title>A &amp; B &#39;c&#39; &lt;3 &quot;q&quot;</title><published>2026-11-17T09:00:00+00:00</published>
    <media:group><media:title>WRONG</media:title></media:group></entry>
    <entry><yt:videoId>bad!</yt:videoId><title>x</title></entry></feed>`;
  const r = parseAtomFeed(xml);
  assert.equal(r.length, 1);
  assert.equal(r[0].title, `A & B 'c' <3 "q"`);
  assert.equal(r[0].publishedAt, "2026-11-17T09:00:00+00:00");
});

test("serialize: sorted desc, 2-space, trailing newline, _note preserved, updatedAt only on change", () => {
  const videos = clone(seed.videos);
  const same = serializeVideosDoc(seed, videos, { now: NOW, changed: false });
  const sameDoc = JSON.parse(same);
  assert.equal(sameDoc.updatedAt, seed.updatedAt);
  assert.equal(sameDoc._note, seed._note);
  assert.ok(same.endsWith("}\n") && same.includes('\n  "schemaVersion"'));
  const dates = Object.values(sameDoc.videos).map((v) => v.publishedAt);
  assert.deepEqual([...dates].sort().reverse(), dates);
  const changed = JSON.parse(serializeVideosDoc(seed, videos, { now: NOW, changed: true }));
  assert.equal(changed.updatedAt, NOW);
  // second run on the serialized output is a no-op
  assert.ok(videosEqual(seed.videos, sameDoc.videos));
  assert.equal(serializeVideosDoc(sameDoc, sameDoc.videos, { now: NOW, changed: false }), same);
});

test("no-op merge of seed produces no change", () => {
  const r = mergeEntries(seed.videos, [], lock, NOW);
  assert.ok(videosEqual(seed.videos, r.videos));
  assert.deepEqual(r.updated, []);
});
