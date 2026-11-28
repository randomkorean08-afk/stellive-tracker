// Pure Gemini AI song-scoring helpers (browser + Node safe, no Node-only imports).
// Handles request building, response validation/clamping, target selection,
// rubric blending (re-exported from derive.mjs), and UTC daily video-length budget tracking.

import { RUBRIC_ITEMS, GROUP_SONG_MIN_MEMBERS, effective, blendRubric } from "./derive.mjs";

export { blendRubric };

export const PROMPT_VERSION = 1;
export const DEFAULT_K = 5;
export const DEFAULT_DAILY_SECONDS = 25200; // 7 hours (under ~8h/day Gemini free-tier YouTube limit)
export const USAGE_RETENTION_DAYS = 7;
export const LONG_VIDEO_THRESHOLD_SEC = 720;
export const LONG_VIDEO_WINDOW_SEC = 600;
export const UNKNOWN_DURATION_ASSUMED_SEC = 600;

export const COUNTED_CATEGORIES = new Set(["solo_cover", "collab_cover", "live_special", "original"]);
export const ELIGIBLE_CATEGORIES = new Set([...COUNTED_CATEGORIES, "stream_song"]);

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const round1 = (x) => Math.round(x * 10) / 10;

const RUBRIC_DESCRIPTIONS = {
  vocalization: "성대 접촉·공명 균형·성구 전환 등 기본 발성 완성도 (Basic vocalization: cord closure, resonance balance, register connection; exclude ornaments & breath length)",
  pitch: "음정 정확도와 도약·전조·고음 구간 피치 안정성 (Pitch accuracy & intonation stability across leaps, modulations, and high notes)",
  rhythm: "박자 정확도, 그루브, 프레이즈 진입·이탈 타이밍 일치도 (Rhythm & timing accuracy, groove, pocket; exclude intentional expressive rubato)",
  range: "저음~고음 실전 가용 음역폭과 테시투라 지속 소화력 (Usable vocal range & tessitura endurance)",
  volume: "믹싱 게인이 아닌 실제 발성 투사력과 강약 출력 폭 (Acoustic vocal projection & dynamic power; ignore mixing/mastering loudness)",
  tone: "보컬 고유 음색 매력도·식별력 및 곡에 맞는 질감 운용력 (Timbre attractiveness, recognizability, and tone color control)",
  technique: "비브라토, 꺾기, 벤딩, 런·애드리브 등 가창 기교 정교함 (Vocal technique: vibrato, scoops/bends, runs/ad-libs)",
  expression: "가사 해석, 감정선 구축, 다이나믹 대비로 서사를 살리는 능력 (Musical expression, phrasing narrative, dynamic contrast)",
  breath: "프레이즈 내 호흡 지지력, 숨 고르기 자연스러움과 유지력 (Breath support, phrasing stamina, natural intake placement)",
  live: "생라이브 환경에서의 가창 일관성; 스튜디오 커버는 영상에서 관찰되는 호흡·안정성·생동감 기준 (Live vocal consistency / raw vocal stability)",
};

const cmpDateDesc = (a, b) => {
  const pa = a.publishedAt ?? "";
  const pb = b.publishedAt ?? "";
  if (pa !== pb) return pa < pb ? 1 : -1;
  return a.videoId < b.videoId ? -1 : a.videoId > b.videoId ? 1 : 0;
};

/** Whether a video's effective metadata qualifies for AI scoring (1-2 members, listed song, not deleted/private). */
export function isAiScoreEligible(video, override) {
  if (!video || video.status === "deleted" || video.status === "private") return false;
  const eff = effective(video, override);
  if (eff.excluded || eff.needsReview) return false;
  if (!ELIGIBLE_CATEGORIES.has(eff.category)) return false;
  return eff.members.length >= 1 && eff.members.length < GROUP_SONG_MIN_MEMBERS;
}

/** Long video (> 720s, or unknown duration for live_special) uses a 0s-600s clip window. */
export function isLongScoringVideo({ category, durationSec } = {}) {
  if (isNum(durationSec) && durationSec > LONG_VIDEO_THRESHOLD_SEC) return true;
  if (category === "live_special" && (!isNum(durationSec) || durationSec <= 0)) return true;
  return false;
}

/** Seconds sent to Gemini for daily budget accounting (window length for long videos, durationSec else, 600 if unknown). */
export function estimateVideoRequestSeconds({ category, durationSec } = {}) {
  if (isLongScoringVideo({ category, durationSec })) return LONG_VIDEO_WINDOW_SEC;
  if (isNum(durationSec) && durationSec > 0) return durationSec;
  return UNKNOWN_DURATION_ASSUMED_SEC;
}

/** Normalize members input ([{ key, displayName }] or string[]) to [{ key, displayName }]. */
function normalizeMembers(members) {
  return (members ?? []).map((m) =>
    typeof m === "string" ? { key: m, displayName: m } : { key: m.key, displayName: m.displayName ?? m.key },
  );
}

/**
 * Build the Gemini v1beta generateContent request body for a single song video.
 * Passes the public YouTube URL via fileData, uses low media resolution (audio matters, not frames),
 * and sets a 0s-600s videoMetadata window for long videos (>720s or live_special with unknown duration).
 */
export function buildScoringRequest({ videoId, title = "", members = [], category = "", durationSec = null } = {}) {
  const memberList = normalizeMembers(members);
  const longVideo = isLongScoringVideo({ category, durationSec });

  const filePart = {
    fileData: {
      fileUri: `https://www.youtube.com/watch?v=${videoId}`,
      mimeType: "video/*",
    },
    ...(longVideo
      ? { videoMetadata: { startOffset: "0s", endOffset: `${LONG_VIDEO_WINDOW_SEC}s` } }
      : {}),
  };

  const rubricLines = RUBRIC_ITEMS.map(
    (it) => `- ${it.key} (${it.label}, max ${it.max}, ${it.group}): ${RUBRIC_DESCRIPTIONS[it.key]}`,
  ).join("\n");

  const memberLines = memberList.map((m) => `- "${m.key}": ${m.displayName}`).join("\n");
  const duetRule =
    memberList.length >= 2
      ? "This is a multi-singer song (duet). Identify and score EACH listed singer separately using their voice timbre, singing parts, title credits, or on-screen captions. If separating their voices is truly impossible, score the shared vocal performance for both members and set confidence to \"low\"."
      : "Score the listed singer based on their vocal performance in this video (set confidence to \"high\", \"medium\", or \"low\" depending on audio clarity).";

  const promptText = [
    "You are an expert vocal evaluator. Listen carefully to the singing performance in this YouTube video and score each listed member on the 10-item vocal rubric.",
    "",
    `Video Title: ${title}`,
    `Category: ${category || "unknown"}`,
    longVideo ? `Note: Only the first ${LONG_VIDEO_WINDOW_SEC}s window is provided.` : "",
    "",
    "Members to score (use these exact keys):",
    memberLines,
    "",
    "Rubric items (score each from 0 to its max, up to 1 decimal place):",
    rubricLines,
    "",
    duetRule,
    "If the video contains no singing performance at all (e.g. pure talking, gaming, or announcement with no singing), set notSinging to true.",
    "Return JSON only matching the schema.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  const itemsSchema = {
    type: "OBJECT",
    properties: Object.fromEntries(
      RUBRIC_ITEMS.map((it) => [it.key, { type: "NUMBER", minimum: 0, maximum: it.max }]),
    ),
    required: RUBRIC_ITEMS.map((it) => it.key),
  };

  const memberScoreSchema = {
    type: "OBJECT",
    properties: {
      items: itemsSchema,
      confidence: { type: "STRING", enum: ["high", "medium", "low"] },
    },
    required: ["items", "confidence"],
  };

  const responseSchema = {
    type: "OBJECT",
    properties: {
      members: {
        type: "OBJECT",
        properties: Object.fromEntries(memberList.map((m) => [m.key, memberScoreSchema])),
        required: memberList.map((m) => m.key),
      },
      notSinging: { type: "BOOLEAN" },
    },
    required: ["members"],
  };

  return {
    contents: [
      {
        role: "user",
        parts: [filePart, { text: promptText }],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      mediaResolution: "MEDIA_RESOLUTION_LOW",
      responseSchema,
    },
  };
}

/** Extract parsed JSON payload from a raw Gemini generateContent envelope or direct JSON/object. */
function unwrapResponsePayload(json) {
  let payload = json;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      return { ok: false, error: `invalid JSON string: ${e.message}` };
    }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "response is not an object" };
  }
  if (Array.isArray(payload.candidates)) {
    const cand = payload.candidates[0];
    if (!cand) return { ok: false, error: "no candidates in response" };
    const parts = cand.content?.parts ?? [];
    const text = parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("").trim();
    if (!text) return { ok: false, error: `empty candidate text (finishReason: ${cand.finishReason ?? "unknown"})` };
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    try {
      payload = JSON.parse(cleaned);
    } catch (e) {
      return { ok: false, error: `invalid candidate JSON: ${e.message}` };
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, error: "candidate payload is not an object" };
    }
  }
  return { ok: true, payload };
}

/**
 * Parse, validate, clamp to [0, max], and round to 1 decimal a Gemini scoring response.
 * Accepts either a Gemini generateContent envelope or the parsed JSON payload directly.
 * @returns {{ ok: boolean, notSinging?: boolean, scores: Record<string, { items: object, confidence: string }> | null, error: string | null }}
 */
export function parseScoringResponse(json, members) {
  const unwrapped = unwrapResponsePayload(json);
  if (!unwrapped.ok) return { ok: false, scores: null, error: unwrapped.error };
  const { payload } = unwrapped;

  if (payload.notSinging === true) {
    return { ok: true, notSinging: true, scores: {}, error: null };
  }

  const expectedKeys = normalizeMembers(members).map((m) => m.key);
  if (!expectedKeys.length) return { ok: false, scores: null, error: "no expected members provided" };
  if (!payload.members || typeof payload.members !== "object" || Array.isArray(payload.members)) {
    return { ok: false, scores: null, error: "missing members object" };
  }

  const scores = {};
  for (const key of expectedKeys) {
    const entry = payload.members[key];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, scores: null, error: `missing member: ${key}` };
    }
    const rawItems = entry.items;
    if (!rawItems || typeof rawItems !== "object" || Array.isArray(rawItems)) {
      return { ok: false, scores: null, error: `missing items for member: ${key}` };
    }
    const items = {};
    for (const it of RUBRIC_ITEMS) {
      const val = rawItems[it.key];
      if (!isNum(val)) {
        return { ok: false, scores: null, error: `invalid number for ${key}.${it.key}` };
      }
      const clamped = Math.min(it.max, Math.max(0, val));
      items[it.key] = round1(clamped);
    }
    const confidence =
      entry.confidence === "high" || entry.confidence === "medium" || entry.confidence === "low"
        ? entry.confidence
        : "medium";
    scores[key] = { items, confidence };
  }

  return { ok: true, notSinging: false, scores, error: null };
}

/**
 * Pick eligible songs not yet scored with the current PROMPT_VERSION (and not permanently skipped).
 * Priority: counted categories first, then stream_song; newest publishedAt first within each tier.
 */
export function pickScoreTargets(videos, overrides, lock, aiScores, { limit } = {}) {
  const vMap = videos?.videos ?? videos ?? {};
  const ovMap = overrides?.videos ?? overrides ?? {};
  const aiMap = aiScores?.videos ?? {};
  const cutoffMs = aiScores?.scoreSince ? Date.parse(aiScores.scoreSince) : NaN;
  const memberMap = new Map(
    (lock?.channels ?? []).filter((c) => c.type === "member").map((c) => [c.key, c]),
  );

  const candidates = [];
  for (const [id, v] of Object.entries(vMap)) {
    const videoId = v?.videoId ?? id;
    if (Number.isFinite(cutoffMs)) {
      const seenMs = v?.firstSeenAt ? Date.parse(v.firstSeenAt) : NaN;
      if (!Number.isFinite(seenMs) || seenMs <= cutoffMs) continue;
    }
    const ov = ovMap[videoId];
    if (!isAiScoreEligible(v, ov)) continue;
    const existing = aiMap[videoId];
    if (existing?.skipped) continue;
    if (existing?.members && (existing.promptVersion === PROMPT_VERSION || existing.promptVersion === "import-v1")) continue;

    const eff = effective(v, ov);
    candidates.push({
      videoId,
      title: v.title ?? "",
      category: eff.category,
      members: eff.members.map((k) => ({ key: k, displayName: memberMap.get(k)?.displayName ?? k })),
      publishedAt: v.publishedAt ?? null,
      durationSec: isNum(v.durationSec) ? v.durationSec : null,
      _tier: COUNTED_CATEGORIES.has(eff.category) ? 0 : 1,
    });
  }

  candidates.sort((a, b) => {
    if (a._tier !== b._tier) return a._tier - b._tier;
    return cmpDateDesc(a, b);
  });

  const clean = candidates.map(({ _tier, ...rest }) => rest);
  if (limit === undefined || limit === null) return clean;
  const n = Math.max(0, Math.floor(Number(limit) || 0));
  return clean.slice(0, n);
}

// ---------------------------------------------------------------- daily UTC budget helpers

export function utcDayKey(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  return d.toISOString().slice(0, 10);
}

/** Keep only the last `keepDays` UTC days relative to `todayKey` (sorted chronologically). */
export function pruneUsage(usage, todayKey, keepDays = USAGE_RETENTION_DAYS) {
  const todayMs = Date.parse(`${todayKey}T00:00:00Z`);
  if (!Number.isFinite(todayMs)) return {};
  const cutoffKey = new Date(todayMs - (keepDays - 1) * 86400e3).toISOString().slice(0, 10);
  const out = {};
  for (const k of Object.keys(usage ?? {}).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
    if (k < cutoffKey) continue;
    const u = usage[k];
    const seconds = isNum(u?.seconds) && u.seconds >= 0 ? u.seconds : 0;
    const requests = isNum(u?.requests) && u.requests >= 0 ? u.requests : 0;
    out[k] = { seconds, requests };
  }
  return out;
}

export function canSpendBudget(usage, todayKey, addSeconds, dailyLimitSeconds = DEFAULT_DAILY_SECONDS) {
  const used = isNum(usage?.[todayKey]?.seconds) ? usage[todayKey].seconds : 0;
  return used + addSeconds <= dailyLimitSeconds;
}

export function recordUsage(usage, todayKey, addSeconds, keepDays = USAGE_RETENTION_DAYS) {
  const pruned = pruneUsage(usage, todayKey, keepDays);
  const prev = pruned[todayKey] ?? { seconds: 0, requests: 0 };
  pruned[todayKey] = {
    seconds: prev.seconds + addSeconds,
    requests: prev.requests + 1,
  };
  return pruneUsage(pruned, todayKey, keepDays);
}

// ---------------------------------------------------------------- stable serialization

function canonicalMemberEntry(entry) {
  const items = {};
  for (const it of RUBRIC_ITEMS) {
    if (entry?.items && it.key in entry.items) items[it.key] = entry.items[it.key];
  }
  return { items, confidence: entry?.confidence ?? "medium" };
}

function canonicalVideoEntry(entry) {
  if (entry?.skipped) {
    return { scoredAt: entry.scoredAt, skipped: entry.skipped };
  }
  const members = {};
  for (const m of Object.keys(entry?.members ?? {}).sort()) {
    members[m] = canonicalMemberEntry(entry.members[m]);
  }
  return {
    scoredAt: entry.scoredAt,
    model: entry.model,
    promptVersion: entry.promptVersion,
    members,
  };
}

export function serializeAiScoresDoc({ schemaVersion = 1, model, promptVersion = PROMPT_VERSION, scoreSince = null, updatedAt = null, usage = {}, videos = {} } = {}) {
  const sortedVideos = {};
  for (const id of Object.keys(videos).sort()) {
    sortedVideos[id] = canonicalVideoEntry(videos[id]);
  }
  const sortedUsage = {};
  for (const day of Object.keys(usage ?? {}).sort()) {
    const u = usage[day];
    sortedUsage[day] = { seconds: u?.seconds ?? 0, requests: u?.requests ?? 0 };
  }
  const doc = {
    schemaVersion,
    model,
    promptVersion,
    ...(scoreSince != null ? { scoreSince } : {}),
    updatedAt,
    usage: sortedUsage,
    videos: sortedVideos,
  };
  return JSON.stringify(doc, null, 2) + "\n";
}
