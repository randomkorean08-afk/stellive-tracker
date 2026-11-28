#!/usr/bin/env node
// Gemini AI song-scoring entry point. The ONLY file this script writes is data/ai-scores.json.
// (videos / ratings / overrides / channels-lock / playlists / baseline / docs / fixtures are read-only.)
//
// Usage: node scripts/score-songs.mjs [--dry-run] [--limit N]
// Env: GEMINI_API_KEY, GEMINI_MODEL (default "gemini-flash-latest"),
//      SCORE_LIMIT (default 15), SCORE_DAILY_SECONDS (default 25200 = 7h).

import { readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { redactKey } from "../lib/collector.mjs";
import {
  PROMPT_VERSION,
  DEFAULT_DAILY_SECONDS,
  buildScoringRequest,
  canSpendBudget,
  estimateVideoRequestSeconds,
  parseScoringResponse,
  pickScoreTargets,
  pruneUsage,
  recordUsage,
  serializeAiScoresDoc,
  utcDayKey,
} from "../lib/ai-score.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIDEOS_PATH = path.join(ROOT, "data", "videos.json");
const OVERRIDES_PATH = path.join(ROOT, "data", "overrides.json");
const LOCK_PATH = path.join(ROOT, "data", "channels-lock.json");
const RATINGS_PATH = path.join(ROOT, "data", "ratings.json"); // read-only: memberRubric calibration
const AI_SCORES_PATH = path.join(ROOT, "data", "ai-scores.json");

const DEFAULT_MODEL = "gemini-flash-latest";
const DEFAULT_LIMIT = 15;
const DELAY_MS = 500;
const BASE_BACKOFF_MS = 1000;
const MAX_UNPARSEABLE_FAILS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function positiveIntOr(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function parseArgs(argv, env = process.env) {
  const o = {
    dryRun: false,
    limit: positiveIntOr(env.SCORE_LIMIT, DEFAULT_LIMIT),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--limit") o.limit = positiveIntOr(argv[++i], o.limit);
    else if (a.startsWith("--limit=")) o.limit = positiveIntOr(a.split("=")[1], o.limit);
    else console.warn(`[warn] unknown option ignored: ${a}`);
  }
  return o;
}

async function readJson(p, fallback) {
  try {
    return JSON.parse((await readFile(p, "utf8")).replace(/^\uFEFF/, ""));
  } catch (e) {
    if (fallback !== undefined && e?.code === "ENOENT") return fallback;
    throw e;
  }
}

async function readResponseText(res) {
  if (typeof res?.text === "function") return await res.text();
  if (typeof res?.json === "function") return JSON.stringify(await res.json());
  return "";
}

/**
 * Distinguish auth/config errors (model 404, schema 400, invalid key) from genuine video-level permanent errors.
 * Ambiguous 400/403/404 responses are treated as config_error so we never poison videos as permanently skipped.
 */
function classifyClientError(status, bodyText) {
  if (status === 401 || /API_KEY_INVALID|API key not valid|API key expired/i.test(bodyText)) {
    return { kind: "auth_error", status };
  }
  if (/models\/|is not found for API version|not supported for generateContent|Invalid JSON payload|Unknown name|response_schema|GenerateContentRequest|generation_config|media_resolution/i.test(bodyText)) {
    return { kind: "config_error", status };
  }
  if (/\bprivate\b/i.test(bodyText) && !/API key|permission/i.test(bodyText)) {
    return { kind: "permanent", reason: "private", status };
  }
  if (/video.*(unavailable|not found|does not exist|removed|deleted|inaccessible|unplayable|unsupported|restricted|blocked)|unavailable|unplayable|no longer available|age.?restricted|members.?only|cannot access.*youtube|unsupported.*(media|url|mime)/i.test(bodyText)) {
    return { kind: "permanent", reason: "unavailable", status };
  }
  return { kind: "config_error", status };
}

async function postWithBackoff(url, body, { apiKey, fetchImpl, sleepImpl, maxRetries = 3, baseDelayMs = BASE_BACKOFF_MS }) {
  const payload = JSON.stringify(body);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: payload,
        signal: AbortSignal.timeout(120000),
      });
    } catch (e) {
      const detail = redactKey(e?.message ?? String(e), apiKey);
      if (attempt < maxRetries) {
        await sleepImpl(baseDelayMs * 2 ** attempt);
        continue;
      }
      return { kind: "transient", detail };
    }

    if (res.status === 200) {
      try {
        return { kind: "ok", json: await res.json() };
      } catch (e) {
        return { kind: "unparseable", detail: redactKey(e?.message ?? String(e), apiKey) };
      }
    }

    const rawText = await readResponseText(res).catch(() => "");
    const safeDetail = redactKey(rawText, apiKey);

    if (res.status === 429 && /RESOURCE_EXHAUSTED|quota|exceeded your current quota/i.test(rawText)) {
      return { kind: "quota_exhausted", status: 429, detail: safeDetail };
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt < maxRetries) {
        await sleepImpl(baseDelayMs * 2 ** attempt);
        continue;
      }
      return { kind: "transient", status: res.status, detail: safeDetail };
    }

    if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
      return { ...classifyClientError(res.status, rawText), detail: safeDetail };
    }

    return { kind: "transient", status: res.status, detail: safeDetail };
  }
  return { kind: "transient", detail: "max retries exceeded" };
}

function recordUnparseableFailure(nextVideos, videoId, now) {
  const prevFails = Number(nextVideos[videoId]?.failCount) || 0;
  const failCount = prevFails + 1;
  if (failCount >= MAX_UNPARSEABLE_FAILS) {
    nextVideos[videoId] = { scoredAt: now, promptVersion: PROMPT_VERSION, skipped: "unparseable", failCount };
    return { permanent: true, failCount };
  }
  nextVideos[videoId] = { failCount, lastErrorAt: now };
  return { permanent: false, failCount };
}

/**
 * Score eligible song videos via Gemini API (pure orchestration with injectable fetch/sleep).
 * Never mutates input objects; returns summary and serialized document when changes occurred.
 */
export async function scoreSongs({
  videos,
  overrides = { videos: {} },
  lock,
  calibration = null,
  aiScores = null,
  apiKey = "",
  model = DEFAULT_MODEL,
  limit = DEFAULT_LIMIT,
  dailySeconds = DEFAULT_DAILY_SECONDS,
  dryRun = false,
  fetchImpl = fetch,
  sleepImpl = sleep,
  delayMs = DELAY_MS,
  baseDelayMs = BASE_BACKOFF_MS,
  maxRetries = 3,
  now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  log = (s) => console.log(s),
  warn = (s) => console.warn(s),
} = {}) {
  const allTargets = pickScoreTargets(videos, overrides, lock, aiScores);
  const targets = allTargets.slice(0, Math.max(0, limit));

  if (dryRun) {
    const byCat = {};
    for (const t of allTargets) byCat[t.category] = (byCat[t.category] ?? 0) + 1;
    log(`== score-songs (dry-run) ${now} ==`);
    log(`eligible unscored targets: ${allTargets.length} (by category: ${JSON.stringify(byCat)})`);
    log(`selected this run (limit ${limit}): ${targets.length}`);
    for (const t of targets) {
      log(`  ${t.videoId} [${t.category}] (${t.publishedAt ?? "-"}) ${t.members.map((m) => m.key).join(",")} — ${t.title}`);
    }
    if (targets.length > 0) {
      const sample = buildScoringRequest({ ...targets[0], calibration });
      log(`sample request for ${targets[0].videoId}:`);
      log(JSON.stringify(sample, null, 2));
    }
    return { dryRun: true, skippedRun: false, allTargets, targets, scored: 0, skipped: 0, errors: 0, stoppedReason: null, changed: false, doc: aiScores, text: null };
  }

  if (!apiKey) {
    log("GEMINI_API_KEY not set, skipping");
    return { dryRun: false, skippedRun: true, allTargets, targets, scored: 0, skipped: 0, errors: 0, stoppedReason: "no_api_key", changed: false, doc: aiScores, text: null };
  }

  const todayKey = utcDayKey(now);
  const prevVideos = aiScores?.videos ?? {};
  const nextVideos = { ...prevVideos };
  const initialPrunedUsage = pruneUsage(aiScores?.usage ?? {}, todayKey);
  let nextUsage = initialPrunedUsage;
  let videosChanged = false;
  let usageChanged = JSON.stringify(initialPrunedUsage) !== JSON.stringify(aiScores?.usage ?? {});

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let scored = 0;
  let skipped = 0;
  let errors = 0;
  let stoppedReason = null;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const reqSeconds = estimateVideoRequestSeconds(t);
    if (!canSpendBudget(nextUsage, todayKey, reqSeconds, dailySeconds)) {
      log("daily budget reached");
      stoppedReason = "daily_budget";
      break;
    }

    const body = buildScoringRequest({ ...t, calibration });
    const res = await postWithBackoff(url, body, { apiKey, fetchImpl, sleepImpl, maxRetries, baseDelayMs });

    if (res.kind === "quota_exhausted") {
      warn(`[warn] quota exhausted (429 RESOURCE_EXHAUSTED) on ${t.videoId}; stopping cleanly.`);
      stoppedReason = "quota_exhausted";
      break;
    }
    if (res.kind === "auth_error" || res.kind === "config_error") {
      warn(`[warn] Gemini API ${res.kind} (${res.status}) on ${t.videoId}: ${res.detail}`);
      stoppedReason = res.kind;
      break;
    }
    if (res.kind === "transient") {
      errors++;
      warn(`[warn] transient error on ${t.videoId} (${res.status ?? "network"}): ${res.detail}`);
    } else if (res.kind === "permanent") {
      nextVideos[t.videoId] = { scoredAt: now, promptVersion: PROMPT_VERSION, skipped: res.reason };
      videosChanged = true;
      skipped++;
      log(`skipped ${t.videoId}: ${res.reason} (HTTP ${res.status})`);
    } else if (res.kind === "unparseable") {
      const outcome = recordUnparseableFailure(nextVideos, t.videoId, now);
      videosChanged = true;
      if (outcome.permanent) skipped++;
      else errors++;
      warn(`[warn] unparseable JSON response on ${t.videoId} (fail ${outcome.failCount}/${MAX_UNPARSEABLE_FAILS}): ${res.detail}`);
    } else if (res.kind === "ok") {
      nextUsage = recordUsage(nextUsage, todayKey, reqSeconds);
      usageChanged = true;
      const parsed = parseScoringResponse(res.json, t.members);
      if (!parsed.ok) {
        const outcome = recordUnparseableFailure(nextVideos, t.videoId, now);
        videosChanged = true;
        if (outcome.permanent) skipped++;
        else errors++;
        warn(`[warn] invalid scoring payload on ${t.videoId} (fail ${outcome.failCount}/${MAX_UNPARSEABLE_FAILS}): ${parsed.error}`);
      } else if (parsed.notSinging) {
        nextVideos[t.videoId] = { scoredAt: now, promptVersion: PROMPT_VERSION, skipped: "not_singing" };
        videosChanged = true;
        skipped++;
        log(`skipped ${t.videoId}: not_singing`);
      } else {
        nextVideos[t.videoId] = {
          scoredAt: now,
          model,
          promptVersion: PROMPT_VERSION,
          members: parsed.scores,
        };
        videosChanged = true;
        scored++;
        log(`scored ${t.videoId} (${t.members.map((m) => m.key).join(",")})`);
      }
    }

    if (delayMs > 0 && i < targets.length - 1) await sleepImpl(delayMs);
  }

  const changed = videosChanged || usageChanged || !aiScores;
  const doc = {
    schemaVersion: 1,
    model,
    promptVersion: PROMPT_VERSION,
    ...(aiScores?.scoreSince != null ? { scoreSince: aiScores.scoreSince } : {}),
    updatedAt: videosChanged ? now : (aiScores?.updatedAt ?? null),
    usage: nextUsage,
    videos: nextVideos,
  };
  const text = serializeAiScoresDoc(doc);

  log(`== score-songs summary: scored=${scored}, skipped=${skipped}, errors=${errors}${stoppedReason ? `, stopped=${stoppedReason}` : ""} ==`);
  return { dryRun: false, skippedRun: false, allTargets, targets, scored, skipped, errors, stoppedReason, changed, doc, text };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = process.env.GEMINI_API_KEY || "";
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const dailySeconds = positiveIntOr(process.env.SCORE_DAILY_SECONDS, DEFAULT_DAILY_SECONDS);

  if (!opts.dryRun && !apiKey) {
    console.log("GEMINI_API_KEY not set, skipping");
    return;
  }

  const [videos, overrides, lock, ratings, aiScores] = await Promise.all([
    readJson(VIDEOS_PATH),
    readJson(OVERRIDES_PATH, { schemaVersion: 1, videos: {} }),
    readJson(LOCK_PATH),
    readJson(RATINGS_PATH, { memberRubric: {} }),
    readJson(AI_SCORES_PATH, { schemaVersion: 1, model, promptVersion: PROMPT_VERSION, updatedAt: null, usage: {}, videos: {} }),
  ]);

  const res = await scoreSongs({
    videos,
    overrides,
    lock,
    calibration: ratings?.memberRubric ?? null,
    aiScores,
    apiKey,
    model,
    limit: opts.limit,
    dailySeconds,
    dryRun: opts.dryRun,
  });

  if (!res.dryRun && !res.skippedRun && res.changed) {
    const tmpPath = `${AI_SCORES_PATH}.tmp`;
    await writeFile(tmpPath, res.text, "utf8");
    await rename(tmpPath, AI_SCORES_PATH);
    console.log("wrote data/ai-scores.json");
  }
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().catch((e) => {
    console.error("fatal:", redactKey(e?.message ?? String(e), process.env.GEMINI_API_KEY || ""));
    process.exit(1);
  });
}
