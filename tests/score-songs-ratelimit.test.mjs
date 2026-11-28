import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreSongs, parseArgs, parseRateLimitError } from "../scripts/score-songs.mjs";
import { buildScoringRequest, estimateVideoRequestSeconds, PROMPT_VERSION } from "../lib/ai-score.mjs";

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
  durationSec: extra.durationSec === undefined ? null : extra.durationSec,
  auto: {
    category: extra.category ?? "solo_cover",
    members: extra.members ?? ["akane-lize"],
    reviewRequired: false,
    reviewReasons: [],
  },
});

const validPayload = (members = ["akane-lize"]) => ({
  candidates: [{
    content: {
      parts: [{
        text: JSON.stringify({
          members: Object.fromEntries(members.map((m) => [m, {
            items: { vocalization: 14, pitch: 9, rhythm: 9, range: 9, volume: 9, tone: 9, technique: 9, expression: 9, breath: 9, live: 4.5 },
            confidence: "high",
          }])),
          notSinging: false,
        }),
      }],
    },
  }],
  usageMetadata: { promptTokenCount: 12345 },
});

const mk429 = ({ quotaId, quotaMetric, message = "Quota exceeded", retryDelay } = {}) => ({
  status: 429,
  text: async () => JSON.stringify({
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      message,
      details: [
        ...(quotaId || quotaMetric ? [{
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [{ ...(quotaId ? { quotaId } : {}), ...(quotaMetric ? { quotaMetric } : {}) }],
        }] : []),
        ...(retryDelay !== undefined ? [{
          "@type": "type.googleapis.com/google.rpc.RetryInfo",
          retryDelay,
        }] : []),
      ],
    },
  }),
});

test("parseRateLimitError: classifies per-day vs per-minute vs unknown-with-RetryInfo", () => {
  const perDay = parseRateLimitError(JSON.stringify({
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      message: "Quota exceeded",
      details: [
        { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests" }] },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "45s" },
      ],
    },
  }));
  assert.equal(perDay.classification, "per_day");
  assert.ok(perDay.quotaInfo.includes("GenerateRequestsPerDayPerProjectPerModel-FreeTier"));

  const perMin = parseRateLimitError(JSON.stringify({
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      message: "Quota exceeded",
      details: [
        { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateContentInputTokensPerModelPerMinute-FreeTier", quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_input_token_count" }] },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "37.5s" },
      ],
    },
  }));
  assert.equal(perMin.classification, "per_minute");
  assert.equal(perMin.retryDelayMs, 37500);

  const unknownWithRetry = parseRateLimitError(JSON.stringify({
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      message: "Rate limit",
      details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "150s" }],
    },
  }));
  assert.equal(unknownWithRetry.classification, "per_minute");
  assert.equal(unknownWithRetry.retryDelayMs, 150000);
});

test("scoreSongs: per-minute 429 with RetryInfo waits and retries same video then succeeds, redacting key", async () => {
  const SECRET = "AIzaSyRateLimitSecret999";
  const videos = { videos: { v1aaaaaaaaa: mkVideo("v1aaaaaaaaa", "2026-11-30") } };
  const sleeps = [];
  const logs = [];
  let attempt = 0;

  const res = await scoreSongs({
    videos,
    lock,
    aiScores: { schemaVersion: 1, scoreSince: "2026-11-28T00:00:00Z", usage: {}, videos: {} },
    apiKey: SECRET,
    delayMs: 0,
    jitterMs: () => 500,
    sleepImpl: async (ms) => sleeps.push(ms),
    log: (s) => logs.push(s),
    warn: (s) => logs.push(s),
    fetchImpl: async () => {
      attempt++;
      if (attempt === 1) {
        return mk429({
          quotaId: "GenerateContentInputTokensPerModelPerMinute-FreeTier",
          quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_input_token_count",
          message: `Quota exceeded key=${SECRET}`,
          retryDelay: "37.5s",
        });
      }
      if (attempt === 2) {
        // PerMinute without RetryInfo -> 60s default
        return mk429({
          quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
          message: "Rate limit per minute",
        });
      }
      if (attempt === 3) {
        // RetryInfo > 120s -> capped at 120s
        return mk429({
          quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
          retryDelay: "150s",
        });
      }
      return { status: 200, json: async () => validPayload(["akane-lize"]) };
    },
  });

  assert.equal(attempt, 4);
  assert.deepEqual(sleeps, [38000, 60000, 120000]);
  assert.equal(res.scored, 1);
  assert.equal(res.stoppedReason, null);
  assert.ok(res.doc.videos.v1aaaaaaaaa.members["akane-lize"]);
  assert.ok(logs.some((l) => l.includes("GenerateContentInputTokensPerModelPerMinute-FreeTier")));
  assert.ok(logs.some((l) => l.includes("scored 1, skipped 0, transient 0")));
  for (const line of logs) {
    assert.ok(!line.includes(SECRET), `API key leaked: ${line}`);
  }
});

test("scoreSongs: per-day 429 stops cleanly even if RetryInfo is present and logs quotaId without key", async () => {
  const SECRET = "AIzaSyPerDaySecret111";
  const videos = {
    videos: {
      v1aaaaaaaaa: mkVideo("v1aaaaaaaaa", "2026-11-30"),
      v2aaaaaaaaa: mkVideo("v2aaaaaaaaa", "2026-11-29"),
    },
  };
  const sleeps = [];
  const logs = [];
  let calls = 0;

  const res = await scoreSongs({
    videos,
    lock,
    aiScores: { schemaVersion: 1, scoreSince: "2026-11-28T00:00:00Z", usage: {}, videos: {} },
    apiKey: SECRET,
    delayMs: 0,
    sleepImpl: async (ms) => sleeps.push(ms),
    log: (s) => logs.push(s),
    warn: (s) => logs.push(s),
    fetchImpl: async () => {
      calls++;
      return mk429({
        quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
        quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
        message: `Exceeded requests per day key=${SECRET}`,
        retryDelay: "30s",
      });
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(sleeps, []);
  assert.equal(res.stoppedReason, "quota_exhausted");
  assert.equal(res.doc.videos.v1aaaaaaaaa, undefined);
  assert.ok(logs.some((l) => l.includes("GenerateRequestsPerDayPerProjectPerModel-FreeTier")));
  assert.ok(logs.some((l) => l.includes("stopped: quota_exhausted")));
  for (const line of logs) {
    assert.ok(!line.includes(SECRET));
  }
});

test("scoreSongs: repeated per-minute 429 stops with rate_limited after per-video and per-run caps", async () => {
  const videos = {
    videos: {
      v1aaaaaaaaa: mkVideo("v1aaaaaaaaa", "2026-11-30"),
      v2aaaaaaaaa: mkVideo("v2aaaaaaaaa", "2026-11-29"),
    },
  };
  const sleeps1 = [];
  const resPerVideo = await scoreSongs({
    videos,
    lock,
    aiScores: { schemaVersion: 1, scoreSince: "2026-11-28T00:00:00Z", usage: {}, videos: {} },
    apiKey: "TEST_KEY",
    delayMs: 0,
    jitterMs: () => 0,
    sleepImpl: async (ms) => sleeps1.push(ms),
    log: () => {},
    warn: () => {},
    fetchImpl: async () => mk429({
      quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
      retryDelay: "20s",
    }),
  });
  assert.deepEqual(sleeps1, [20000, 20000, 20000]);
  assert.equal(resPerVideo.stoppedReason, "rate_limited");
  assert.equal(resPerVideo.doc.videos.v1aaaaaaaaa, undefined);

  // Per-run total waiting cap (~10 min = 600s) across multiple videos
  let calls = 0;
  const sleeps2 = [];
  const manyVideos = {
    videos: {
      v1aaaaaaaaa: mkVideo("v1aaaaaaaaa", "2026-11-30"),
      v2aaaaaaaaa: mkVideo("v2aaaaaaaaa", "2026-11-29"),
      v3aaaaaaaaa: mkVideo("v3aaaaaaaaa", "2026-11-28"),
    },
  };
  const resTotalCap = await scoreSongs({
    videos: manyVideos,
    lock,
    aiScores: { schemaVersion: 1, scoreSince: "2026-11-28T00:00:00Z", usage: {}, videos: {} },
    apiKey: "TEST_KEY",
    delayMs: 0,
    jitterMs: () => 0,
    maxRateLimitWaitTotalMs: 250_000,
    sleepImpl: async (ms) => sleeps2.push(ms),
    log: () => {},
    warn: () => {},
    fetchImpl: async () => {
      calls++;
      // v1: waits 100s + 100s then succeeds (total 200s); v2 needs 100s -> 300s > 250s -> stops rate_limited
      if (calls === 1 || calls === 2) {
        return mk429({ quotaId: "PerMinute", retryDelay: "100s" });
      }
      if (calls === 3) {
        return { status: 200, json: async () => validPayload(["akane-lize"]) };
      }
      return mk429({ quotaId: "PerMinute", retryDelay: "100s" });
    },
  });
  assert.deepEqual(sleeps2, [100000, 100000]);
  assert.equal(resTotalCap.scored, 1);
  assert.equal(resTotalCap.stoppedReason, "rate_limited");
});

test("scoreSongs & parseArgs: default 15s gap honoured between requests and SCORE_GAP_MS / SCORE_MAX_RUN_MS parsed", async () => {
  const defaults = parseArgs([], {});
  assert.equal(defaults.gapMs, 15000);
  assert.equal(defaults.maxRunMs, 900000);
  const custom = parseArgs([], { SCORE_GAP_MS: "22000", SCORE_MAX_RUN_MS: "600000" });
  assert.equal(custom.gapMs, 22000);
  assert.equal(custom.maxRunMs, 600000);

  const videos = {
    videos: {
      v1aaaaaaaaa: mkVideo("v1aaaaaaaaa", "2026-11-30"),
      v2aaaaaaaaa: mkVideo("v2aaaaaaaaa", "2026-11-29"),
    },
  };
  const sleeps = [];
  const res = await scoreSongs({
    videos,
    lock,
    aiScores: { schemaVersion: 1, scoreSince: "2026-11-28T00:00:00Z", usage: {}, videos: {} },
    apiKey: "TEST_KEY",
    sleepImpl: async (ms) => sleeps.push(ms),
    fetchImpl: async () => ({ status: 200, json: async () => validPayload(["akane-lize"]) }),
    log: () => {},
    warn: () => {},
  });
  assert.equal(res.scored, 2);
  assert.deepEqual(sleeps, [15000]);
});

test("scoreSongs: wall-clock cap (maxRunMs) saves progress and stops cleanly with time_budget", async () => {
  const videos = {
    videos: {
      v1aaaaaaaaa: mkVideo("v1aaaaaaaaa", "2026-11-30"),
      v2aaaaaaaaa: mkVideo("v2aaaaaaaaa", "2026-11-29"),
      v3aaaaaaaaa: mkVideo("v3aaaaaaaaa", "2026-11-28"),
    },
  };
  let nowMs = 1000;
  const logs = [];
  const res = await scoreSongs({
    videos,
    lock,
    aiScores: { schemaVersion: 1, scoreSince: "2026-11-28T00:00:00Z", usage: {}, videos: {} },
    apiKey: "TEST_KEY",
    delayMs: 1000,
    maxRunMs: 10000,
    clockMs: () => nowMs,
    sleepImpl: async (ms) => { nowMs += ms; },
    fetchImpl: async () => {
      nowMs += 6000;
      return { status: 200, json: async () => validPayload(["akane-lize"]) };
    },
    log: (s) => logs.push(s),
    warn: (s) => logs.push(s),
  });

  // After v1 (elapsed 6000) + gap (1000 -> 7000), v2 runs (elapsed 13000 >= 10000), so stops before v3
  assert.equal(res.scored, 2);
  assert.equal(res.stoppedReason, "time_budget");
  assert.ok(logs.includes("time budget reached"));
  assert.ok(res.doc.videos.v1aaaaaaaaa.members["akane-lize"]);
  assert.ok(res.doc.videos.v2aaaaaaaaa.members["akane-lize"]);
  assert.equal(res.doc.videos.v3aaaaaaaaa, undefined);
});

test("budget & request offsets: 300s assumed for normal songs (no offsets), 600s for live_special and >720s", () => {
  for (const cat of ["solo_cover", "collab_cover", "original", "stream_song"]) {
    assert.equal(estimateVideoRequestSeconds({ category: cat, durationSec: null }), 300, `${cat} unknown -> 300s`);
    const req = buildScoringRequest({
      videoId: "Song1234567",
      title: "Cover",
      members: [{ key: "akane-lize", displayName: "아카네 리제" }],
      category: cat,
      durationSec: null,
    });
    assert.equal(req.contents[0].parts[0].videoMetadata, undefined, `${cat} unknown has no videoMetadata offsets`);
  }

  assert.equal(estimateVideoRequestSeconds({ category: "live_special", durationSec: null }), 600);
  const liveReq = buildScoringRequest({
    videoId: "Live1234567",
    title: "3D Live",
    members: [{ key: "akane-lize", displayName: "아카네 리제" }],
    category: "live_special",
    durationSec: null,
  });
  assert.deepEqual(liveReq.contents[0].parts[0].videoMetadata, { startOffset: "0s", endOffset: "600s" });
  assert.equal(estimateVideoRequestSeconds({ category: "solo_cover", durationSec: 900 }), 600);
});

test("scoreSongs: 503 UNAVAILABLE uses 20s/40s/80s backoff and stops after 3 consecutive 503 videos", async () => {
  const videos = {
    videos: {
      v1aaaaaaaaa: mkVideo("v1aaaaaaaaa", "2026-11-30"),
      v2aaaaaaaaa: mkVideo("v2aaaaaaaaa", "2026-11-29"),
      v3aaaaaaaaa: mkVideo("v3aaaaaaaaa", "2026-11-28"),
      v4aaaaaaaaa: mkVideo("v4aaaaaaaaa", "2026-11-27"),
    },
  };
  const sleeps = [];
  let calls = 0;

  const res = await scoreSongs({
    videos,
    lock,
    aiScores: { schemaVersion: 1, scoreSince: "2026-11-28T00:00:00Z", usage: {}, videos: {} },
    apiKey: "TEST_KEY",
    delayMs: 0,
    maxRunMs: 60 * 60 * 1000,
    sleepImpl: async (ms) => sleeps.push(ms),
    log: () => {},
    warn: () => {},
    fetchImpl: async () => {
      calls++;
      return {
        status: 503,
        text: async () => JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "high demand" } }),
      };
    },
  });

  // 3 videos * (1 initial + 3 retries = 4 calls, 3 sleeps: 20s, 40s, 80s) = 12 calls, v4 not attempted
  assert.equal(calls, 12);
  assert.deepEqual(sleeps, [
    20000, 40000, 80000,
    20000, 40000, 80000,
    20000, 40000, 80000,
  ]);
  assert.equal(res.errors, 3);
  assert.equal(res.stoppedReason, "model_unavailable");
});

test("scoreSongs: GEMINI_FALLBACK_MODEL tries fallback once on 503 and records actual model used", async () => {
  const videos = {
    videos: {
      v1aaaaaaaaa: mkVideo("v1aaaaaaaaa", "2026-11-30"),
    },
  };
  const urls = [];
  const res = await scoreSongs({
    videos,
    lock,
    aiScores: { schemaVersion: 1, scoreSince: "2026-11-28T00:00:00Z", usage: {}, videos: {} },
    apiKey: "TEST_KEY",
    model: "gemini-2.5-flash",
    fallbackModel: "gemini-2.5-flash-lite",
    delayMs: 0,
    unavailableBaseDelayMs: 10,
    maxRetries: 1,
    sleepImpl: async () => {},
    log: () => {},
    warn: () => {},
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes("gemini-2.5-flash:")) {
        return {
          status: 503,
          text: async () => JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "high demand" } }),
        };
      }
      return { status: 200, json: async () => validPayload(["akane-lize"]) };
    },
  });

  assert.equal(urls.length, 3); // primary attempt 0, primary retry 1, fallback once
  assert.ok(urls[2].includes("gemini-2.5-flash-lite:generateContent"));
  assert.equal(res.scored, 1);
  assert.equal(res.errors, 0);
  assert.equal(res.stoppedReason, null);
  assert.equal(res.doc.videos.v1aaaaaaaaa.model, "gemini-2.5-flash-lite");
  assert.equal(res.doc.videos.v1aaaaaaaaa.promptVersion, PROMPT_VERSION);
});
