import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROMPT_VERSION,
  buildScoringRequest,
  parseScoringResponse,
  blendRubric,
  pickScoreTargets,
  estimateVideoRequestSeconds,
  canSpendBudget,
  recordUsage,
  pruneUsage,
  utcDayKey,
} from "../lib/ai-score.mjs";
import { RUBRIC_ITEMS, deriveAll } from "../lib/derive.mjs";
import { fingerprintRepo } from "../lib/draft-guard.mjs";
import { readJson, clone } from "./load.mjs";

const channels = readJson("data/channels-lock.json");
const videos = readJson("data/videos.json");
const overrides = readJson("data/overrides.json");
const ratings = readJson("data/ratings.json");
const baseline = readJson("data/baseline/baseline-2026-11-17.json");

const sampleItems = (v = 8.0) => ({
  vocalization: Math.min(15, v + 4),
  pitch: v,
  rhythm: v,
  range: v,
  volume: v,
  tone: v,
  technique: v,
  expression: v,
  breath: v,
  live: Math.min(5, v / 2),
});

test("buildScoringRequest: YouTube fileData, generationConfig, schema, and long-video offsets", () => {
  const shortReq = buildScoringRequest({
    videoId: "R_B4tmy2DVA",
    title: "출항 Cover",
    members: [{ key: "akane-lize", displayName: "아카네 리제" }],
    category: "solo_cover",
    durationSec: 245,
  });
  const part0 = shortReq.contents[0].parts[0];
  assert.deepEqual(part0.fileData, {
    fileUri: "https://www.youtube.com/watch?v=R_B4tmy2DVA",
    mimeType: "video/*",
  });
  assert.equal(part0.videoMetadata, undefined, "short video has no startOffset/endOffset");
  assert.equal(shortReq.generationConfig.temperature, 0);
  assert.equal(shortReq.generationConfig.responseMimeType, "application/json");
  assert.equal(shortReq.generationConfig.mediaResolution, "MEDIA_RESOLUTION_LOW");
  assert.deepEqual(shortReq.generationConfig.responseSchema.properties.members.required, ["akane-lize"]);
  assert.deepEqual(
    shortReq.generationConfig.responseSchema.properties.members.properties["akane-lize"].properties.items.required,
    RUBRIC_ITEMS.map((i) => i.key),
  );

  // Long video (> 720s) gets 0s-600s videoMetadata
  const longReq = buildScoringRequest({
    videoId: "LongVid1234",
    title: "긴 커버",
    members: [
      { key: "akane-lize", displayName: "아카네 리제" },
      { key: "shirayuki-hina", displayName: "시라유키 히나" },
    ],
    category: "collab_cover",
    durationSec: 900,
  });
  assert.deepEqual(longReq.contents[0].parts[0].videoMetadata, { startOffset: "0s", endOffset: "600s" });
  assert.match(longReq.contents[0].parts[1].text, /confidence.*low/i);

  // live_special with unknown duration gets 0s-600s window
  const liveReq = buildScoringRequest({
    videoId: "LiveVid1234",
    title: "3D 라이브",
    members: [{ key: "akane-lize", displayName: "아카네 리제" }],
    category: "live_special",
    durationSec: null,
  });
  assert.deepEqual(liveReq.contents[0].parts[0].videoMetadata, { startOffset: "0s", endOffset: "600s" });
});

test("parseScoringResponse: validates, clamps, rounds to 1 decimal, handles notSinging and rejects bad data", () => {
  const members = [{ key: "akane-lize", displayName: "아카네 리제" }];

  // Valid Gemini envelope with out-of-range values & decimals
  const envelope = {
    candidates: [{
      content: {
        parts: [{
          text: JSON.stringify({
            members: {
              "akane-lize": {
                items: {
                  vocalization: 18.44, // clamped to 15
                  pitch: -2.1,         // clamped to 0
                  rhythm: 9.26,        // rounded to 9.3
                  range: 8.74,
                  volume: 9.0,
                  tone: 9.95,          // rounded to 10.0
                  technique: 9.1,
                  expression: 9.2,
                  breath: 8.5,
                  live: 7.2,           // clamped to 5
                },
                confidence: "high",
              },
            },
            notSinging: false,
          }),
        }],
      },
    }],
  };
  const ok = parseScoringResponse(envelope, members);
  assert.equal(ok.ok, true);
  assert.equal(ok.notSinging, false);
  assert.equal(ok.scores["akane-lize"].items.vocalization, 15);
  assert.equal(ok.scores["akane-lize"].items.pitch, 0);
  assert.equal(ok.scores["akane-lize"].items.rhythm, 9.3);
  assert.equal(ok.scores["akane-lize"].items.range, 8.7);
  assert.equal(ok.scores["akane-lize"].items.tone, 10);
  assert.equal(ok.scores["akane-lize"].items.live, 5);
  assert.equal(ok.scores["akane-lize"].confidence, "high");

  // notSinging
  const ns = parseScoringResponse({ members: {}, notSinging: true }, members);
  assert.equal(ns.ok, true);
  assert.equal(ns.notSinging, true);

  // Missing member
  const missing = parseScoringResponse({ members: {} }, members);
  assert.equal(missing.ok, false);

  // NaN / non-numeric item
  const badItems = sampleItems(8);
  badItems.pitch = "9.5";
  assert.equal(parseScoringResponse({ members: { "akane-lize": { items: badItems, confidence: "high" } } }, members).ok, false);
  badItems.pitch = NaN;
  assert.equal(parseScoringResponse({ members: { "akane-lize": { items: badItems, confidence: "high" } } }, members).ok, false);

  // Invalid JSON
  assert.equal(parseScoringResponse("{not-json", members).ok, false);
});

test("blendRubric: n=0 returns exact prior, K=5 weighting, and no-prior mean", () => {
  const prior = ratings.memberRubric["akane-lize"].items;
  const exact = blendRubric(prior, [], 5);
  assert.deepEqual(exact, prior);
  assert.notEqual(exact, prior, "returns a fresh object");

  const song1 = sampleItems(8.0);
  const song2 = sampleItems(10.0);
  const blended = blendRubric(prior, [song1, song2], 5);
  for (const it of RUBRIC_ITEMS) {
    const expected = (prior[it.key] * 5 + song1[it.key] + song2[it.key]) / 7;
    assert.ok(Math.abs(blended[it.key] - expected) < 1e-12, it.key);
  }

  // Without prior
  assert.equal(blendRubric(null, [], 5), null);
  const meanOnly = blendRubric(null, [song1, song2], 5);
  for (const it of RUBRIC_ITEMS) {
    assert.ok(Math.abs(meanOnly[it.key] - (song1[it.key] + song2[it.key]) / 2) < 1e-12, it.key);
  }
});

test("pickScoreTargets: eligibility, priority, scoreSince cutoff, and promptVersion", () => {
  const mk = (id, cat, members, publishedAt, firstSeenAt, extra = {}) => ({
    videoId: id,
    title: `Title ${id}`,
    publishedAt,
    firstSeenAt,
    status: extra.status ?? "active",
    durationSec: extra.durationSec ?? null,
    auto: {
      category: cat,
      members,
      reviewRequired: extra.reviewRequired ?? false,
      reviewReasons: [],
    },
  });

  const vDoc = {
    videos: {
      old1aaaaaaa: mk("old1aaaaaaa", "solo_cover", ["akane-lize"], "2026-11-29", "2026-11-27T23:59:59Z"), // before cutoff
      eq1aaaaaaaa: mk("eq1aaaaaaaa", "solo_cover", ["akane-lize"], "2026-11-29", "2026-11-28T00:00:00Z"), // equal cutoff -> excluded (strictly after)
      grp1aaaaaaa: mk("grp1aaaaaaa", "original", ["akane-lize", "shirayuki-hina", "ayatsuno-yuni"], "2026-11-29", "2026-11-28T01:00:00Z"), // 3 members -> excluded
      exc1aaaaaaa: mk("exc1aaaaaaa", "solo_cover", ["akane-lize"], "2026-11-29", "2026-11-28T01:00:00Z"), // override exclude -> excluded
      rev1aaaaaaa: mk("rev1aaaaaaa", "solo_cover", ["akane-lize"], "2026-11-29", "2026-11-28T01:00:00Z", { reviewRequired: true }), // needsReview -> excluded
      del1aaaaaaa: mk("del1aaaaaaa", "solo_cover", ["akane-lize"], "2026-11-29", "2026-11-28T01:00:00Z", { status: "deleted" }),
      prv1aaaaaaa: mk("prv1aaaaaaa", "solo_cover", ["akane-lize"], "2026-11-29", "2026-11-28T01:00:00Z", { status: "private" }),
      done1aaaaaa: mk("done1aaaaaa", "solo_cover", ["akane-lize"], "2026-11-29", "2026-11-28T01:00:00Z"),
      imp1aaaaaaa: mk("imp1aaaaaaa", "solo_cover", ["akane-lize"], "2026-11-29", "2026-11-28T01:00:00Z"),
      skip1aaaaaa: mk("skip1aaaaaa", "solo_cover", ["akane-lize"], "2026-11-29", "2026-11-28T01:00:00Z"),
      stale1aaaaa: mk("stale1aaaaa", "original", ["akane-lize"], "2026-11-28", "2026-11-28T01:00:00Z"), // old promptVersion -> re-picked
      soloNewaaaa: mk("soloNewaaaa", "solo_cover", ["akane-lize"], "2026-11-29", "2026-11-28T02:00:00Z"),
      streamNewaa: mk("streamNewaa", "stream_song", ["akane-lize"], "2026-11-30", "2026-11-28T03:00:00Z"), // newer date, lower priority than counted
      duetOldaaaa: mk("duetOldaaaa", "collab_cover", ["akane-lize", "shirayuki-hina"], "2026-11-27", "2026-11-28T02:00:00Z"),
    },
  };
  const ovDoc = { videos: { exc1aaaaaaa: { exclude: true } } };
  const aiDoc = {
    scoreSince: "2026-11-28T00:00:00Z",
    videos: {
      done1aaaaaa: { scoredAt: "2026-11-28T02:00:00Z", model: "m", promptVersion: PROMPT_VERSION, members: {} },
      imp1aaaaaaa: { scoredAt: "2026-11-28T02:00:00Z", model: "external-import", promptVersion: "import-v1", members: {} },
      skip1aaaaaa: { scoredAt: "2026-11-28T02:00:00Z", skipped: "not_singing" },
      stale1aaaaa: { scoredAt: "2026-11-28T02:00:00Z", model: "m", promptVersion: 0, members: {} },
    },
  };

  const targets = pickScoreTargets(vDoc, ovDoc, channels, aiDoc);
  assert.deepEqual(
    targets.map((t) => t.videoId),
    ["soloNewaaaa", "stale1aaaaa", "duetOldaaaa", "streamNewaa"],
    "counted newest-first, then stream_song; respects scoreSince, promptVersion, import-v1, skipped, group, excluded, review, deleted/private",
  );
  assert.equal(targets[2].members[1].displayName, "시라유키 히나");
  assert.equal(pickScoreTargets(vDoc, ovDoc, channels, aiDoc, { limit: 2 }).length, 2);
});

test("budget helpers: window length accounting, limit check, day rollover, and 7-day pruning", () => {
  assert.equal(estimateVideoRequestSeconds({ category: "solo_cover", durationSec: 210 }), 210);
  assert.equal(estimateVideoRequestSeconds({ category: "solo_cover", durationSec: 900 }), 600);
  assert.equal(estimateVideoRequestSeconds({ category: "live_special", durationSec: null }), 600);
  assert.equal(estimateVideoRequestSeconds({ category: "solo_cover", durationSec: null }), 600);

  const day1 = utcDayKey("2026-11-28T10:00:00Z");
  const day2 = utcDayKey("2026-11-29T00:01:00Z");
  let usage = {
    "2026-11-19": { seconds: 100, requests: 1 },
    "2026-11-22": { seconds: 200, requests: 1 },
  };
  usage = recordUsage(usage, day1, 500);
  assert.equal(usage["2026-11-19"], undefined, "older than 7 days pruned");
  assert.equal(usage["2026-11-22"].seconds, 200, "7th day kept");
  assert.deepEqual(usage[day1], { seconds: 500, requests: 1 });
  assert.equal(canSpendBudget(usage, day1, 200, 600), false);
  assert.equal(canSpendBudget(usage, day1, 100, 600), true);
  assert.equal(canSpendBudget(usage, day2, 500, 600), true, "new UTC day resets budget");

  const pruned = pruneUsage(usage, "2026-11-30", 7);
  assert.equal(pruned["2026-11-22"], undefined, "2026-11-22 pruned once today is 2026-11-30");
  assert.equal(pruned[day1].seconds, 500);
});

test("deriveAll: absent aiScores is byte-identical; provided aiScores blends eligible songs only", () => {
  const baseArgs = { channels, videos, overrides, ratings, baseline };
  const withoutAi = deriveAll(baseArgs);
  assert.equal(JSON.stringify(withoutAi), JSON.stringify(deriveAll({ ...baseArgs, aiScores: null })));
  assert.equal("aiSongsN" in withoutAi.memberCards[0], false);

  const emptyAi = deriveAll({ ...baseArgs, aiScores: { schemaVersion: 1, videos: {} } });
  for (const c of emptyAi.memberCards) {
    assert.equal(c.aiSongsN, 0);
    const orig = withoutAi.memberCards.find((x) => x.key === c.key);
    assert.equal(c.rubricTotal, orig.rubricTotal);
    assert.equal(c.rankA, orig.rankA);
  }

  // Pick a real eligible solo video for ayatsuno-yuni and a group song (STAR TRAIL)
  const yuniRow = withoutAi.videoRows.find((r) => r.listed && !r.groupSong && r.members.length === 1 && r.members[0] === "ayatsuno-yuni" && r.status !== "deleted" && r.status !== "private");
  assert.ok(yuniRow, "real repo has an eligible song for yuni");
  const aiScores = {
    schemaVersion: 1,
    videos: {
      [yuniRow.videoId]: {
        scoredAt: "2026-11-28T01:00:00Z",
        model: "gemini-flash-latest",
        promptVersion: 1,
        members: { "ayatsuno-yuni": { items: sampleItems(10.0), confidence: "high" } },
      },
      "v094-E3Pmtk": { // group song (9 members) -> MUST be ignored in blending even if present
        scoredAt: "2026-11-28T01:00:00Z",
        model: "gemini-flash-latest",
        promptVersion: 1,
        members: { "ayatsuno-yuni": { items: sampleItems(1.0), confidence: "high" } },
      },
      "eSI7RsjZy1E": { // excluded in overrides -> MUST be ignored
        scoredAt: "2026-11-28T01:00:00Z",
        model: "gemini-flash-latest",
        promptVersion: 1,
        members: { "tokino-meri": { items: sampleItems(1.0), confidence: "high" } },
      },
      "skipped1234": { scoredAt: "2026-11-28T01:00:00Z", skipped: "not_singing" },
    },
  };

  const withAi = deriveAll({ ...baseArgs, aiScores });
  const yuniBefore = withoutAi.memberCards.find((c) => c.key === "ayatsuno-yuni");
  const yuniAfter = withAi.memberCards.find((c) => c.key === "ayatsuno-yuni");
  assert.equal(yuniAfter.aiSongsN, 1);
  assert.ok(yuniAfter.rubricTotal > yuniBefore.rubricTotal, "blending 10.0 song raised Yuni's rubricTotal");
  assert.equal(yuniAfter.songAvg, yuniBefore.songAvg, "B songAvg unchanged");
  assert.equal(yuniAfter.rankB, yuniBefore.rankB, "B rank unchanged");
  assert.equal(withAi.memberCards.find((c) => c.key === "tokino-meri").aiSongsN, 0, "excluded video ignored");
});

test("UI: scorecard shows 'AI 평가 N곡 반영', disclaimer updated, and gallery/search hide per-song scores", async () => {
  class FakeNode {}
  class FakeText extends FakeNode { constructor(t) { super(); this.text = String(t); } get textContent() { return this.text; } }
  class FakeEl extends FakeNode {
    constructor(tag, ns = "http://www.w3.org/1999/xhtml") {
      super(); this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.namespaceURI = ns;
      const cls = new Set();
      this.classList = { add: (c) => cls.add(c), remove: (c) => cls.delete(c), toggle: (c, on) => ((on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) };
    }
    append(...xs) { for (const x of xs) this.children.push(x instanceof FakeNode ? x : new FakeText(x)); }
    get firstChild() { return this.children[0] ?? null; }
    removeChild(c) { this.children.splice(this.children.indexOf(c), 1); }
    setAttribute(k, v) { this.attrs[k] = v; if (k.startsWith("data-")) this.dataset[k.slice(5)] = v; }
    addEventListener() {}
    scrollIntoView() {}
    set textContent(t) { this.children = [new FakeText(t)]; }
    get textContent() { return this.children.map((c) => c.textContent).join(""); }
  }
  const all = (el, pred, out = []) => { if (pred(el)) out.push(el); for (const c of el.children ?? []) all(c, pred, out); return out; };
  const hasClass = (el, cls) => el instanceof FakeEl && String(el.attrs.class ?? "").split(/\s+/).includes(cls);

  globalThis.Node = FakeNode;
  globalThis.document = { createElement: (t) => new FakeEl(t), createElementNS: (ns, t) => new FakeEl(t, ns), createTextNode: (t) => new FakeText(t) };

  const { DISCLAIMER } = await import("../app/dom.js");
  assert.match(DISCLAIMER, /Gemini AI/);

  const { state } = await import("../app/store.js");
  const { renderScorecard, setSortMode } = await import("../app/scorecard.js");
  const { renderGallery } = await import("../app/gallery.js");

  const d0 = deriveAll({ channels, videos, overrides, ratings, baseline });
  const lizeSong = d0.videoRows.find((r) => r.listed && !r.groupSong && r.members.includes("akane-lize") && r.status !== "deleted");
  state.repo = {
    channels,
    videos,
    overrides,
    ratings,
    baseline,
    aiScores: {
      schemaVersion: 1,
      videos: {
        [lizeSong.videoId]: {
          scoredAt: "2026-11-28T01:00:00Z",
          model: "gemini-flash-latest",
          promptVersion: 1,
          members: { "akane-lize": { items: sampleItems(9.0), confidence: "high" } },
        },
      },
    },
    fingerprint: fingerprintRepo(ratings, overrides),
  };

  const scoreRoot = new FakeEl("div");
  setSortMode("A");
  renderScorecard(scoreRoot);
  assert.ok(scoreRoot.textContent.includes("AI 평가 1곡 반영"));
  assert.ok(!scoreRoot.textContent.includes("점수 98.4"), "song search in dashboard hides per-song score");

  const galRoot = new FakeEl("div");
  renderGallery(galRoot);
  assert.equal(all(galRoot, (e) => hasClass(e, "gscore")).length, 0, "no .gscore badges in gallery");
  assert.ok(!galRoot.textContent.includes("기준 점수"), "no per-song score text in preview");
});
