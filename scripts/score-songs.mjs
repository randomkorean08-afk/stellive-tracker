#!/usr/bin/env node
// Gemini AI song-scoring entry point. The ONLY file this script writes is data/ai-scores.json.
// (videos / ratings / overrides / channels-lock / playlists / baseline / docs / fixtures are read-only.)
//
// Usage: node scripts/score-songs.mjs [--dry-run] [--limit N]
// Env: GEMINI_API_KEY, GEMINI_MODEL (default "gemini-flash-latest"),
//      GEMINI_FALLBACK_MODEL (default ""),
//      SCORE_LIMIT (default 15), SCORE_DAILY_SECONDS (default 25200 = 7h),
//      SCORE_GAP_MS (default 15000), SCORE_MAX_RUN_MS (default 900000 = 15m).

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
const DEFAULT_GAP_MS = 15_000;
const DEFAULT_MAX_RUN_MS = 15 * 60 * 1000;
const BASE_BACKOFF_MS = 1000;
const DEFAULT_UNAVAILABLE_BACKOFF_MS = 20_000;
const MAX_CONSECUTIVE_503 = 3;
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;
const MAX_RATE_LIMIT_WAIT_MS = 120_000;
const MAX_RATE_LIMIT_WAITS_PER_VIDEO = 3;
const MAX_RATE_LIMIT_WAIT_TOTAL_MS = 10 * 60 * 1000;
const MAX_UNPARSEABLE_FAILS = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const defaultJitterMs = () => Math.floor(Math.random() * 1000);

function positiveIntOr(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function parseArgs(argv, env = process.env) {
  const o = {
    dryRun: false,
    limit: positiveIntOr(env.SCORE_LIMIT, DEFAULT_LIMIT),
    gapMs: positiveIntOr(env.SCORE_GAP_MS, DEFAULT_GAP_MS),
    maxRunMs: positiveIntOr(env.SCORE_MAX_RUN_MS, DEFAULT_MAX_RUN_MS),
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

/**
 * Parse a Gemini 429 error body (google.rpc.QuotaFailure & google.rpc.RetryInfo) to distinguish
 * per-day quota exhaustion from per-minute / retryable rate limits.
 */
export function parseRateLimitError(rawText) {
  let parsed = null;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // non-JSON 429 body
  }
  const err = parsed?.error && typeof parsed.error === "object" ? parsed.error : null;
  const details = Array.isArray(err?.details) ? err.details : [];
  const message = typeof err?.message === "string" ? err.message : "";
  const quotaLabels = [];
  let isPerDay = false;
  let isPerMinute = false;
  let hasRetryInfo = false;
  let retryDelayMs = null;

  for (const d of details) {
    if (!d || typeof d !== "object") continue;
    const type = String(d["@type"] ?? "");
    if (type.includes("QuotaFailure") || Array.isArray(d.violations)) {
      for (const v of d.violations ?? []) {
        if (!v || typeof v !== "object") continue;
        const qid = typeof v.quotaId === "string" ? v.quotaId : "";
        const qm = typeof v.quotaMetric === "string" ? v.quotaMetric : "";
        const desc = typeof v.description === "string" ? v.description : "";
        if (qid) quotaLabels.push(qid);
        if (qm) quotaLabels.push(qm);
        if (v.quotaValue === 0 || (typeof v.quotaValue === "string" && v.quotaValue.trim() === "0")) isPerDay = true;
        const combined = `${qid} ${qm} ${desc}`;
        if (/per[-_\s]*day/i.test(combined)) isPerDay = true;
        if (/per[-_\s]*minute/i.test(combined)) isPerMinute = true;
      }
    }
    if (type.includes("RetryInfo") || typeof d.retryDelay === "string") {
      hasRetryInfo = true;
      const m = /^(\d+(?:\.\d+)?)s$/i.exec(String(d.retryDelay ?? "").trim());
      if (m) retryDelayMs = Math.ceil(Number(m[1]) * 1000);
    }
  }

  if (/per[-_\s]*day/i.test(message)) isPerDay = true;
  if (/per[-_\s]*minute/i.test(message)) isPerMinute = true;

  const isQuotaMessage = /RESOURCE_EXHAUSTED|quota|exceeded your current quota/i.test(String(rawText ?? ""));
  const quotaInfo = [...new Set(quotaLabels)].join(", ");

  let classification = "transient";
  if (isPerDay) classification = "per_day";
  else if (isPerMinute || hasRetryInfo) classification = "per_minute";
  else if (isQuotaMessage) classification = "quota_unknown";

  return { classification, quotaInfo, hasRetryInfo, retryDelayMs };
}

function endpointUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

async function postWithBackoff(url, body, {
  apiKey,
  fetchImpl,
  sleepImpl,
  maxRetries = 3,
  baseDelayMs = BASE_BACKOFF_MS,
  unavailableBaseDelayMs = DEFAULT_UNAVAILABLE_BACKOFF_MS,
  maxRateLimitWaits = MAX_RATE_LIMIT_WAITS_PER_VIDEO,
  rateLimitState = { totalWaitMs: 0, maxTotalWaitMs: MAX_RATE_LIMIT_WAIT_TOTAL_MS },
  jitterMs = defaultJitterMs,
  canWaitMs = () => true,
  onRateLimitWait = null,
}) {
  const payload = JSON.stringify(body);
  let attempt = 0;
  let rateLimitWaits = 0;

  while (true) {
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
        const waitMs = baseDelayMs * 2 ** attempt;
        if (!canWaitMs(waitMs)) return { kind: "time_budget", detail };
        attempt++;
        await sleepImpl(waitMs);
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

    if (res.status === 429) {
      const rl = parseRateLimitError(rawText);
      const safeQuotaInfo = redactKey(rl.quotaInfo, apiKey);

      if (rl.classification === "per_day" || rl.classification === "quota_unknown") {
        return { kind: "quota_exhausted", status: 429, quotaInfo: safeQuotaInfo, detail: safeDetail };
      }

      if (rl.classification === "per_minute") {
        const waitMs = rl.retryDelayMs != null
          ? Math.min(MAX_RATE_LIMIT_WAIT_MS, Math.max(0, rl.retryDelayMs + Math.max(0, jitterMs())))
          : DEFAULT_RATE_LIMIT_WAIT_MS;
        if (rateLimitWaits >= maxRateLimitWaits || rateLimitState.totalWaitMs + waitMs > rateLimitState.maxTotalWaitMs) {
          return { kind: "rate_limited", status: 429, quotaInfo: safeQuotaInfo, detail: safeDetail };
        }
        if (!canWaitMs(waitMs)) {
          return { kind: "time_budget", status: 429, quotaInfo: safeQuotaInfo, detail: safeDetail };
        }
        rateLimitWaits++;
        rateLimitState.totalWaitMs += waitMs;
        onRateLimitWait?.({ waitMs, attempt: rateLimitWaits, maxAttempts: maxRateLimitWaits, quotaInfo: safeQuotaInfo });
        await sleepImpl(waitMs);
        continue;
      }

      if (attempt < maxRetries) {
        const waitMs = baseDelayMs * 2 ** attempt;
        if (!canWaitMs(waitMs)) return { kind: "time_budget", status: 429, detail: safeDetail };
        attempt++;
        await sleepImpl(waitMs);
        continue;
      }
      return { kind: "transient", status: 429, detail: safeDetail };
    }

    if (res.status >= 500) {
      if (attempt < maxRetries) {
        const isUnavailable503 = res.status === 503 && /UNAVAILABLE|high demand/i.test(rawText);
        const stepBase = isUnavailable503 ? unavailableBaseDelayMs : baseDelayMs;
        const waitMs = stepBase * 2 ** attempt;
        if (!canWaitMs(waitMs)) return { kind: "time_budget", status: res.status, detail: safeDetail };
        attempt++;
        await sleepImpl(waitMs);
        continue;
      }
      return { kind: "transient", status: res.status, detail: safeDetail };
    }

    if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
      return { ...classifyClientError(res.status, rawText), detail: safeDetail };
    }

    return { kind: "transient", status: res.status, detail: safeDetail };
  }
}

function recordUnparseableFailure(nextVideos, videoId, now) {
  const prev = nextVideos[videoId];
  const sameVersion = prev?.promptVersion == null || prev.promptVersion === PROMPT_VERSION;
  const prevFails = sameVersion ? (Number(prev?.failCount) || 0) : 0;
  const failCount = prevFails + 1;
  if (failCount >= MAX_UNPARSEABLE_FAILS) {
    nextVideos[videoId] = { scoredAt: now, promptVersion: PROMPT_VERSION, skipped: "unparseable", failCount };
    return { permanent: true, failCount };
  }
  nextVideos[videoId] = { promptVersion: PROMPT_VERSION, failCount, lastErrorAt: now };
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
  fallbackModel = "",
  limit = DEFAULT_LIMIT,
  dailySeconds = DEFAULT_DAILY_SECONDS,
  dryRun = false,
  fetchImpl = fetch,
  sleepImpl = sleep,
  delayMs = DEFAULT_GAP_MS,
  maxRunMs = DEFAULT_MAX_RUN_MS,
  baseDelayMs = BASE_BACKOFF_MS,
  unavailableBaseDelayMs = DEFAULT_UNAVAILABLE_BACKOFF_MS,
  maxRetries = 3,
  maxRateLimitWaits = MAX_RATE_LIMIT_WAITS_PER_VIDEO,
  maxRateLimitWaitTotalMs = MAX_RATE_LIMIT_WAIT_TOTAL_MS,
  jitterMs = defaultJitterMs,
  clockMs = () => Date.now(),
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

  const url = endpointUrl(model);
  const startedAtMs = clockMs();
  const canWaitMs = (waitMs) => maxRunMs <= 0 || (clockMs() - startedAtMs + waitMs) <= maxRunMs;
  const rateLimitState = { totalWaitMs: 0, maxTotalWaitMs: maxRateLimitWaitTotalMs };
  let scored = 0;
  let skipped = 0;
  let errors = 0;
  let consecutive503 = 0;
  let stoppedReason = null;

  for (let i = 0; i < targets.length; i++) {
    try {
      if (maxRunMs > 0 && clockMs() - startedAtMs >= maxRunMs) {
        log("time budget reached");
        stoppedReason = "time_budget";
        break;
      }

      const t = targets[i];
      const reqSeconds = estimateVideoRequestSeconds(t);
      if (!canSpendBudget(nextUsage, todayKey, reqSeconds, dailySeconds)) {
        log("daily budget reached");
        stoppedReason = "daily_budget";
        break;
      }

      const body = buildScoringRequest({ ...t, calibration });
      const backoffOpts = {
        apiKey,
        fetchImpl,
        sleepImpl,
        maxRetries,
        baseDelayMs,
        unavailableBaseDelayMs,
        maxRateLimitWaits,
        rateLimitState,
        jitterMs,
        canWaitMs,
        onRateLimitWait: ({ waitMs, attempt, maxAttempts, quotaInfo }) => {
          warn(`[warn] rate limited (429${quotaInfo ? `; ${quotaInfo}` : ""}) on ${t.videoId}; waiting ${Math.round(waitMs / 1000)}s before retry (${attempt}/${maxAttempts}).`);
        },
      };
      let usedModel = model;
      let usedFallback = false;
      let res = await postWithBackoff(url, body, backoffOpts);

      if (res.kind === "transient" && res.status === 503 && fallbackModel && fallbackModel !== model) {
        if (maxRunMs > 0 && clockMs() - startedAtMs >= maxRunMs) {
          log("time budget reached");
          stoppedReason = "time_budget";
          break;
        }
        warn(`[warn] primary model ${model} returned 503 on ${t.videoId}; trying fallback ${fallbackModel} once.`);
        usedModel = fallbackModel;
        usedFallback = true;
        res = await postWithBackoff(endpointUrl(fallbackModel), body, {
          ...backoffOpts,
          maxRetries: 0,
          maxRateLimitWaits: 0,
        });
      }

      if (res.kind === "time_budget") {
        log("time budget reached");
        stoppedReason = "time_budget";
        break;
      }
      if (res.kind === "quota_exhausted") {
        warn(`[warn] quota exhausted (429 RESOURCE_EXHAUSTED${res.quotaInfo ? `; ${res.quotaInfo}` : ""}) on ${t.videoId}; stopping cleanly.`);
        stoppedReason = "quota_exhausted";
        break;
      }
      if (res.kind === "rate_limited") {
        if (usedFallback) {
          errors++;
          warn(`[warn] fallback model ${fallbackModel} rate limited (429${res.quotaInfo ? `; ${res.quotaInfo}` : ""}) on ${t.videoId} after primary 503; counting as transient.`);
          consecutive503++;
          if (consecutive503 >= MAX_CONSECUTIVE_503) {
            warn(`[warn] ${consecutive503} consecutive 503 errors; stopping cleanly.`);
            stoppedReason = "model_unavailable";
            break;
          }
        } else {
          warn(`[warn] rate limited (429${res.quotaInfo ? `; ${res.quotaInfo}` : ""}) cap reached on ${t.videoId}; stopping cleanly.`);
          stoppedReason = "rate_limited";
          break;
        }
      } else if (res.kind === "auth_error" || res.kind === "config_error") {
        if (usedFallback && res.kind === "config_error") {
          warn(`[warn] fallback model config error (${fallbackModel}, ${res.status}) on ${t.videoId}: ${res.detail}`);
        } else {
          warn(`[warn] Gemini API ${res.kind} (${res.status}) on ${t.videoId}: ${res.detail}`);
        }
        stoppedReason = res.kind;
        break;
      } else if (res.kind === "transient") {
        errors++;
        warn(`[warn] transient error on ${t.videoId} (${res.status ?? "network"}): ${res.detail}`);
        if (res.status === 503) {
          consecutive503++;
          if (consecutive503 >= MAX_CONSECUTIVE_503) {
            warn(`[warn] ${consecutive503} consecutive 503 errors; stopping cleanly.`);
            stoppedReason = "model_unavailable";
            break;
          }
        } else {
          consecutive503 = 0;
        }
      } else if (res.kind === "permanent") {
        consecutive503 = 0;
        nextVideos[t.videoId] = { scoredAt: now, promptVersion: PROMPT_VERSION, skipped: res.reason };
        videosChanged = true;
        skipped++;
        log(`skipped ${t.videoId}: ${res.reason} (HTTP ${res.status})`);
      } else if (res.kind === "unparseable") {
        consecutive503 = 0;
        const outcome = recordUnparseableFailure(nextVideos, t.videoId, now);
        videosChanged = true;
        if (outcome.permanent) skipped++;
        else errors++;
        warn(`[warn] unparseable JSON response on ${t.videoId} (fail ${outcome.failCount}/${MAX_UNPARSEABLE_FAILS}): ${res.detail}`);
      } else if (res.kind === "ok") {
        consecutive503 = 0;
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
          const prevVideo = prevVideos[t.videoId];
          const mergedMembers = { ...parsed.scores };
          for (const [mKey, mEntry] of Object.entries(prevVideo?.members ?? {})) {
            const ver = mEntry?.promptVersion ?? prevVideo?.promptVersion;
            if (ver === "import-v1") {
              mergedMembers[mKey] = mEntry;
            }
          }
          nextVideos[t.videoId] = {
            scoredAt: now,
            model: usedModel,
            promptVersion: PROMPT_VERSION,
            members: mergedMembers,
          };
          videosChanged = true;
          scored++;
          log(`scored ${t.videoId} (${t.members.map((m) => m.key).join(",")})`);
        }
      }

      if (delayMs > 0 && i < targets.length - 1) {
        if (maxRunMs > 0 && clockMs() - startedAtMs + delayMs >= maxRunMs) {
          log("time budget reached");
          stoppedReason = "time_budget";
          break;
        }
        await sleepImpl(delayMs);
      }
    } catch (e) {
      warn(`[warn] unexpected error on ${targets[i]?.videoId ?? "loop"}: ${redactKey(e?.message ?? String(e), apiKey)}`);
      stoppedReason = "error";
      break;
    }
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

  log(`== score-songs summary: scored ${scored}, skipped ${skipped}, transient ${errors}${stoppedReason ? `, stopped: ${stoppedReason}` : ""} ==`);
  return { dryRun: false, skippedRun: false, allTargets, targets, scored, skipped, errors, stoppedReason, changed, doc, text };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = process.env.GEMINI_API_KEY || "";
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || "";
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
    fallbackModel,
    limit: opts.limit,
    dailySeconds,
    delayMs: opts.gapMs,
    maxRunMs: opts.maxRunMs,
    dryRun: opts.dryRun,
  });

  if (!res.dryRun && !res.skippedRun && res.changed) {
    const tmpPath = `${AI_SCORES_PATH}.tmp`;
    await writeFile(tmpPath, res.text, "utf8");
    await rename(tmpPath, AI_SCORES_PATH);
    console.log("wrote data/ai-scores.json");
  }
  if (res.stoppedReason === "error") {
    process.exitCode = 1;
  }
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().catch((e) => {
    console.error("fatal:", redactKey(e?.message ?? String(e), process.env.GEMINI_API_KEY || ""));
    process.exit(1);
  });
}
