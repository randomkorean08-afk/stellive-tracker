import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreSongs, parseArgs } from "../scripts/score-songs.mjs";
import { PROMPT_VERSION } from "../lib/ai-score.mjs";

const lock = {
  channels: [
    { key: "akane-lize", type: "member", displayName: "아카네 리제" },
    { key: "shirayuki-hina", type: "member", displayName: "시라유키 히나" },
  ],
};

const mkVideo = (id, publishedAt, firstSeenAt = "2026-11-28T01:00:00Z", extra = {}) => ({
  videoId: id,
  title: `Song ${id}`,
  publishedAt,
  firstSeenAt,
  status: "active",
  durationSec: extra.durationSec ?? 240,
  auto: { category: extra.category ?? "solo_cover", members: extra.members ?? ["akane-lize"], reviewRequired: false, reviewReasons: [] },
});

const validPayload = (members = ["akane-lize"], notSinging = false) => ({
  candidates: [{
    content: {
      parts: [{
        text: JSON.stringify({
          members: Object.fromEntries(members.map((m) => [m, {
            items: { vocalization: 14, pitch: 9, rhythm: 9, range: 9, volume: 9, tone: 9, technique: 9, expression: 9, breath: 9, live: 4.5 },
            confidence: "high",
          }])),
          notSinging,
        }),
      }],
    },
  }],
});

test("scoreSongs: no API key exits cleanly with message and makes no fetch calls", async () => {
  const logs = [];
  let called = 0;
  const res = await scoreSongs({
    videos: { videos: { v1aaaaaaaaa: mkVideo("v1aaaaaaaaa", "2026-11-29") } },
    lock,
    aiScores: { schemaVersion: 1, scoreSince: "2026-11-28T00:00:00Z", usage: {}, videos: {} },
    apiKey: "",
    fetchImpl: async () => { called++; throw new Error("should not call"); },
    log: (s) => logs.push(s),
    warn: (s) => logs.push(s),
  });
  assert.equal(res.skippedRun, true);
  assert.equal(called, 0);
  assert.ok(logs.includes("GEMINI_API_KEY not set, skipping"));
});

test("scoreSongs: --dry-run prints targets and sample request without network", async () => {
  const logs = [];
  let called = 0;
  const res = await scoreSongs({
    videos: { videos: { v1aaaaaaaaa: mkVideo("v1aaaaaaaaa", "2026-11-29") } },
    lock,
    aiScores: { schemaVersion: 1, scoreSince: "2026-11-28T00:00:00Z", usage: {}, videos: {} },
    dryRun: true,
    fetchImpl: async () => { called++; throw new Error("should not call"); },
    log: (s) => logs.push(s),
    warn: (s) => logs.push(s),
  });
  assert.equal(res.dryRun, true);
  assert.equal(called, 0);
  assert.equal(res.targets.length, 1);
  assert.ok(logs.some((l) => l.includes("v1aaaaaaaaa")));
  assert.ok(logs.some((l) => l.includes("https://www.youtube.com/watch?v=v1aaaaaaaaa")));
});

test("scoreSongs: x-goog-api-key header, key never in URL/logs, 429/5xx backoff, and quota exhaustion stop", async () => {
  const SECRET = "AIzaSySecretTestKey12345";
  const videos = {
    videos: {
      v1aaaaaaaaa: mkVideo("v1aaaaaaaaa", "2026-11-30"),
      v2aaaaaaaaa: mkVideo("v2aaaaaaaaa", "2026-11-29"),
      v3aaaaaaaaa: mkVideo("v3aaaaaaaaa", "2026-11-28"),
    },
  };
  const aiScores = { schemaVersion: 1, scoreSince: "2026-11-28T00:00:00Z", usage: {}, videos: {} };

  const calls = [];
  const sleeps = [];
  const logs = [];
  let v1Attempts = 0;

  const fetchMock = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    assert.ok(!url.includes(SECRET), "API key must never be in URL");
    assert.equal(init.headers["x-goog-api-key"], SECRET);

    if (calls.length === 1) {
      v1Attempts++;
      return { status: 503, text: async () => `upstream fail key=${SECRET}` };
    }
    if (calls.length === 2) {
      v1Attempts++;
      return { status: 429, text: async () => "rate limit slow down" };
    }
    if (calls.length === 3) {
      v1Attempts++;
      return { status: 200, json: async () => validPayload(["akane-lize"]) };
    }
    // Second video hits 429 RESOURCE_EXHAUSTED -> must stop cleanly and record nothing for v2!
    return {
      status: 429,
      text: async () => JSON.stringify({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: `Quota exceeded ${SECRET}` } }),
    };
  };

  const res = await scoreSongs({
    videos,
    lock,
    aiScores,
    apiKey: SECRET,
    fetchImpl: fetchMock,
    sleepImpl: async (ms) => sleeps.push(ms),
    delayMs: 10,
    baseDelayMs: 50,
    maxRetries: 3,
    now: "2026-11-28T12:00:00Z",
    log: (s) => logs.push(s),
    warn: (s) => logs.push(s),
  });

  assert.equal(v1Attempts, 3);
  assert.deepEqual(sleeps, [50, 100, 10]); // 503 backoff, 429 backoff, inter-video delay
  assert.equal(res.scored, 1);
  assert.equal(res.stoppedReason, "quota_exhausted");
  assert.ok(res.doc.videos.v1aaaaaaaaa.members["akane-lize"], "first video kept");
  assert.equal(res.doc.videos.v1aaaaaaaaa.promptVersion, PROMPT_VERSION);
  assert.equal(res.doc.videos.v2aaaaaaaaa, undefined, "nothing recorded for 429 RESOURCE_EXHAUSTED video");
  assert.equal(res.doc.videos.v3aaaaaaaaa, undefined, "third video not attempted after quota stop");
  assert.deepEqual(res.doc.usage["2026-11-28"], { seconds: 240, requests: 1 }, "usage only counted v1");
  for (const line of logs) {
    assert.ok(!line.includes(SECRET), `API key leaked in log: ${line}`);
  }
});

test("scoreSongs: permanent video errors record skipped+promptVersion; unparseable retries 3x via failCount; config errors stop without recording", async () => {
  const videos = {
    videos: {
      vPrivaaaaaa: mkVideo("vPrivaaaaaa", "2026-11-30"),
      vNotSingaaa: mkVideo("vNotSingaaa", "2026-11-29"),
      vBadJsonaaa: mkVideo("vBadJsonaaa", "2026-11-28"),
      vTransaaaaa: mkVideo("vTransaaaaa", "2026-11-27"),
    },
  };
  let aiDoc = { schemaVersion: 1, scoreSince: "2026-11-28T00:00:00Z", usage: {}, videos: {} };
  let idx = 0;
  const fetchMock = async () => {
    idx++;
    if (idx === 1) return { status: 403, text: async () => "Video is private" };
    if (idx === 2) return { status: 200, json: async () => validPayload(["akane-lize"], true) };
    if (idx === 3) return { status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "not-json" }] } }] }) };
    throw new Error("ECONNRESET");
  };

  const res = await scoreSongs({
    videos,
    lock,
    aiScores: aiDoc,
    apiKey: "TEST_KEY",
    fetchImpl: fetchMock,
    sleepImpl: async () => {},
    delayMs: 0,
    maxRetries: 0,
    now: "2026-11-28T12:00:00Z",
    log: () => {},
    warn: () => {},
  });

  assert.equal(res.doc.videos.vPrivaaaaaa.skipped, "private");
  assert.equal(res.doc.videos.vPrivaaaaaa.promptVersion, PROMPT_VERSION);
  assert.equal(res.doc.videos.vNotSingaaa.skipped, "not_singing");
  assert.equal(res.doc.videos.vNotSingaaa.promptVersion, PROMPT_VERSION);
  // 1st unparseable is transient -> failCount=1, no skipped yet!
  assert.equal(res.doc.videos.vBadJsonaaa.skipped, undefined);
  assert.equal(res.doc.videos.vBadJsonaaa.failCount, 1);
  assert.equal(res.doc.videos.vTransaaaaa, undefined, "transient network error leaves video unscored");
  assert.equal(res.skipped, 2);
  assert.equal(res.errors, 2);

  // 2nd and 3rd unparseable failures -> becomes permanent skipped: "unparseable" on 3rd failure
  const badFetch = async () => ({ status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "bad" }] } }] }) });
  const run2 = await scoreSongs({
    videos: { videos: { vBadJsonaaa: videos.videos.vBadJsonaaa } },
    lock,
    aiScores: res.doc,
    apiKey: "TEST_KEY",
    fetchImpl: badFetch,
    sleepImpl: async () => {},
    delayMs: 0,
    maxRetries: 0,
    now: "2026-11-28T13:00:00Z",
    log: () => {},
    warn: () => {},
  });
  assert.equal(run2.doc.videos.vBadJsonaaa.failCount, 2);
  assert.equal(run2.doc.videos.vBadJsonaaa.skipped, undefined);

  const run3 = await scoreSongs({
    videos: { videos: { vBadJsonaaa: videos.videos.vBadJsonaaa } },
    lock,
    aiScores: run2.doc,
    apiKey: "TEST_KEY",
    fetchImpl: badFetch,
    sleepImpl: async () => {},
    delayMs: 0,
    maxRetries: 0,
    now: "2026-11-28T14:00:00Z",
    log: () => {},
    warn: () => {},
  });
  assert.equal(run3.doc.videos.vBadJsonaaa.failCount, 3);
  assert.equal(run3.doc.videos.vBadJsonaaa.skipped, "unparseable");
  assert.equal(run3.doc.videos.vBadJsonaaa.promptVersion, PROMPT_VERSION);

  // Model-not-found 404 or schema 400 stops as config_error without recording skipped
  const cfg404 = await scoreSongs({
    videos: { videos: { vCfg404aaaa: mkVideo("vCfg404aaaa", "2026-11-30") } },
    lock,
    aiScores: { schemaVersion: 1, scoreSince: "2026-11-28T00:00:00Z", usage: {}, videos: {} },
    apiKey: "TEST_KEY",
    fetchImpl: async () => ({ status: 404, text: async () => "models/bad-model is not found for API version v1beta" }),
    sleepImpl: async () => {},
    delayMs: 0,
    log: () => {},
    warn: () => {},
  });
  assert.equal(cfg404.stoppedReason, "config_error");
  assert.equal(cfg404.doc.videos.vCfg404aaaa, undefined, "config error must not mark video skipped");
});

test("scoreSongs: daily budget stops before exceeding limit, rolls over on new UTC day, and prunes >7 days", async () => {
  const videos = {
    videos: {
      v1aaaaaaaaa: mkVideo("v1aaaaaaaaa", "2026-11-30", "2026-11-28T01:00:00Z", { durationSec: 300 }),
      v2aaaaaaaaa: mkVideo("v2aaaaaaaaa", "2026-11-29", "2026-11-28T01:00:00Z", { durationSec: 300 }),
      v3aaaaaaaaa: mkVideo("v3aaaaaaaaa", "2026-11-28", "2026-11-28T01:00:00Z", { durationSec: 300 }),
    },
  };
  const aiScores = {
    schemaVersion: 1,
    scoreSince: "2026-11-28T00:00:00Z",
    usage: {
      "2026-11-18": { seconds: 999, requests: 2 }, // > 7 days old
      "2026-11-28": { seconds: 200, requests: 1 },
    },
    videos: {},
  };
  const logs = [];
  const fetchMock = async () => ({ status: 200, json: async () => validPayload(["akane-lize"]) });

  // Budget = 600s; 200s already used -> v1 (+300 = 500 <= 600) succeeds, v2 (+300 = 800 > 600) stops!
  const day1Res = await scoreSongs({
    videos,
    lock,
    aiScores,
    apiKey: "TEST_KEY",
    dailySeconds: 600,
    fetchImpl: fetchMock,
    sleepImpl: async () => {},
    delayMs: 0,
    now: "2026-11-28T15:00:00Z",
    log: (s) => logs.push(s),
    warn: () => {},
  });
  assert.equal(day1Res.scored, 1);
  assert.equal(day1Res.stoppedReason, "daily_budget");
  assert.ok(logs.includes("daily budget reached"));
  assert.equal(day1Res.doc.usage["2026-11-18"], undefined, "old usage pruned");
  assert.deepEqual(day1Res.doc.usage["2026-11-28"], { seconds: 500, requests: 2 });

  // Next UTC day -> budget resets for 2026-11-29 and scores remaining 2 videos (300 + 300 <= 600)
  const day2Res = await scoreSongs({
    videos,
    lock,
    aiScores: day1Res.doc,
    apiKey: "TEST_KEY",
    dailySeconds: 600,
    fetchImpl: fetchMock,
    sleepImpl: async () => {},
    delayMs: 0,
    now: "2026-11-29T00:05:00Z",
    log: () => {},
    warn: () => {},
  });
  assert.equal(day2Res.scored, 2);
  assert.equal(day2Res.stoppedReason, null);
  assert.deepEqual(day2Res.doc.usage["2026-11-29"], { seconds: 600, requests: 2 });
});

test("parseArgs: respects SCORE_LIMIT env and --limit CLI flag", () => {
  assert.equal(parseArgs([], {}).limit, 15);
  assert.equal(parseArgs([], { SCORE_LIMIT: "8" }).limit, 8);
  assert.equal(parseArgs(["--limit", "3", "--dry-run"], { SCORE_LIMIT: "8" }).limit, 3);
  assert.equal(parseArgs(["--limit=5"], {}).limit, 5);
});
