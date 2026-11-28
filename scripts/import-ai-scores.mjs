#!/usr/bin/env node
// Import externally produced per-member rubric scores (CSV or JSON) into data/ai-scores.json.
// The ONLY file this script writes is data/ai-scores.json.
//
// Usage: node scripts/import-ai-scores.mjs <file.csv|file.json> [--dry-run] [--overwrite]

import { readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RUBRIC_ITEMS, effective } from "../lib/derive.mjs";
import { PROMPT_VERSION, serializeAiScoresDoc } from "../lib/ai-score.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIDEOS_PATH = path.join(ROOT, "data", "videos.json");
const OVERRIDES_PATH = path.join(ROOT, "data", "overrides.json");
const LOCK_PATH = path.join(ROOT, "data", "channels-lock.json");
const AI_SCORES_PATH = path.join(ROOT, "data", "ai-scores.json");

export const IMPORT_MODEL = "external-import";
export const IMPORT_PROMPT_VERSION = "import-v1";
export const CSV_HEADERS = ["videoId", "member", ...RUBRIC_ITEMS.map((it) => it.key)];

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const round1 = (x) => Math.round(x * 10) / 10;

export function parseArgs(argv) {
  const o = { file: null, dryRun: false, overwrite: false };
  for (const a of argv) {
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--overwrite") o.overwrite = true;
    else if (!a.startsWith("-") && !o.file) o.file = a;
    else console.warn(`[warn] unknown option ignored: ${a}`);
  }
  return o;
}

/** Minimal RFC-4180 CSV parser (handles UTF-8 BOM, CRLF/LF, quoted fields, escaped quotes). */
export function parseCsvRows(text) {
  const clean = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  if (!rows.length) return [];

  const header = rows[0].map((h) => h.trim());
  for (const req of CSV_HEADERS) {
    if (!header.includes(req)) {
      throw new Error(`invalid CSV header: missing "${req}" (expected: ${CSV_HEADERS.join(",")})`);
    }
  }
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return rows.slice(1).map((cols, rowIdx) => {
    const obj = { _row: rowIdx + 2 };
    for (const key of CSV_HEADERS) obj[key] = (cols[idx[key]] ?? "").trim();
    return obj;
  });
}

export function parseInputRecords(text, filePath = "") {
  const clean = String(text ?? "").replace(/^\uFEFF/, "");
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json" || (!ext && clean.trimStart().startsWith("["))) {
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed)) throw new Error("JSON import must be an array of objects");
    return parsed.map((row, idx) => ({ ...row, _row: idx + 1 }));
  }
  return parseCsvRows(clean);
}

/** Build lookup map from member key or normalized Korean displayName -> member key. */
function buildMemberResolver(lock) {
  const map = new Map();
  for (const c of lock?.channels ?? []) {
    if (c.type !== "member") continue;
    map.set(c.key, c.key);
    if (c.displayName) {
      map.set(String(c.displayName).normalize("NFKC").trim(), c.key);
    }
  }
  return (raw) => {
    const s = String(raw ?? "").normalize("NFKC").trim();
    return map.get(s) ?? null;
  };
}

function parseNumericScore(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : NaN;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return NaN;
    return Number(t);
  }
  return NaN;
}

/**
 * Validate and import external score rows into an aiScores document (pure, does not mutate inputs).
 */
export function importAiScores({
  records,
  videos,
  overrides = { videos: {} },
  lock,
  aiScores = null,
  overwrite = false,
  dryRun = false,
  now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  log = (s) => console.log(s),
  warn = (s) => console.warn(s),
} = {}) {
  const vMap = videos?.videos ?? videos ?? {};
  const ovMap = overrides?.videos ?? overrides ?? {};
  const resolveMember = buildMemberResolver(lock);

  const rejected = [];
  const warnings = [];
  // Dedupe key: `${videoId}\0${memberKey}` -> last valid row wins
  const deduped = new Map();

  for (let i = 0; i < (records ?? []).length; i++) {
    const r = records[i];
    const rowNum = r?._row ?? i + 1;
    const videoId = String(r?.videoId ?? "").trim();
    const rawMember = String(r?.member ?? "").trim();

    if (!videoId || !(videoId in vMap)) {
      rejected.push({ row: rowNum, videoId, member: rawMember, reason: "unknown videoId (not in videos.json)" });
      continue;
    }

    const memberKey = resolveMember(rawMember);
    if (!memberKey) {
      rejected.push({ row: rowNum, videoId, member: rawMember, reason: `unknown member "${rawMember}"` });
      continue;
    }

    const eff = effective(vMap[videoId], ovMap[videoId]);
    if (!eff.members.includes(memberKey)) {
      rejected.push({ row: rowNum, videoId, member: memberKey, reason: `member "${memberKey}" is not an effective member of ${videoId}` });
      continue;
    }

    const items = {};
    let badItem = null;
    for (const it of RUBRIC_ITEMS) {
      const val = parseNumericScore(r?.[it.key]);
      if (!isNum(val) || val < 0 || val > it.max) {
        badItem = `${it.key}=${r?.[it.key]} (expected 0..${it.max})`;
        break;
      }
      items[it.key] = round1(val);
    }
    if (badItem) {
      rejected.push({ row: rowNum, videoId, member: memberKey, reason: `invalid score ${badItem}` });
      continue;
    }

    const k = `${videoId}\0${memberKey}`;
    if (deduped.has(k)) {
      const msg = `duplicate row for ${videoId} / ${memberKey} at row ${rowNum}; overwriting previous row`;
      warnings.push(msg);
      warn(`[warn] ${msg}`);
    }
    deduped.set(k, { row: rowNum, videoId, memberKey, items });
  }

  const prevVideos = aiScores?.videos ?? {};
  const nextVideos = { ...prevVideos };
  let imported = 0;

  // Group validated entries by videoId
  const byVideo = new Map();
  for (const entry of deduped.values()) {
    let arr = byVideo.get(entry.videoId);
    if (!arr) { arr = []; byVideo.set(entry.videoId, arr); }
    arr.push(entry);
  }

  for (const [videoId, rows] of byVideo.entries()) {
    const existing = nextVideos[videoId];
    if (existing?.skipped && !overwrite) {
      for (const e of rows) {
        rejected.push({ row: e.row, videoId, member: e.memberKey, reason: `existing skipped entry (${existing.skipped}); pass --overwrite to replace` });
      }
      continue;
    }

    const baseMembers = existing && !existing.skipped && existing.members ? { ...existing.members } : {};
    let videoTouched = false;
    for (const e of rows) {
      if (baseMembers[e.memberKey] && !overwrite) {
        rejected.push({ row: e.row, videoId, member: e.memberKey, reason: "already exists; pass --overwrite to replace" });
        continue;
      }
      baseMembers[e.memberKey] = { items: e.items, confidence: "high" };
      imported++;
      videoTouched = true;
    }

    if (videoTouched) {
      nextVideos[videoId] = {
        scoredAt: now,
        model: IMPORT_MODEL,
        promptVersion: IMPORT_PROMPT_VERSION,
        members: baseMembers,
      };
    }
  }

  const changed = imported > 0;
  const doc = {
    schemaVersion: 1,
    model: aiScores?.model ?? "gemini-flash-latest",
    promptVersion: aiScores?.promptVersion ?? PROMPT_VERSION,
    ...(aiScores?.scoreSince != null ? { scoreSince: aiScores.scoreSince } : {}),
    updatedAt: changed ? now : (aiScores?.updatedAt ?? null),
    usage: aiScores?.usage ?? {},
    videos: nextVideos,
  };
  const text = changed ? serializeAiScoresDoc(doc) : null;

  log(`== import-ai-scores ${dryRun ? "(dry-run) " : ""}==`);
  log(`total rows: ${(records ?? []).length}, imported: ${imported}, rejected: ${rejected.length}, warnings: ${warnings.length}`);
  for (const r of rejected) {
    log(`  rejected row ${r.row} (${r.videoId || "-"}, ${r.member || "-"}): ${r.reason}`);
  }

  return { dryRun, imported, rejected, warnings, changed, doc, text };
}

async function readJson(p, fallback) {
  try {
    return JSON.parse((await readFile(p, "utf8")).replace(/^\uFEFF/, ""));
  } catch (e) {
    if (fallback !== undefined && e?.code === "ENOENT") return fallback;
    throw e;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.file) {
    console.error("usage: node scripts/import-ai-scores.mjs <file.csv|file.json> [--dry-run] [--overwrite]");
    process.exit(1);
  }
  const inputPath = path.resolve(opts.file);
  const raw = await readFile(inputPath, "utf8");
  const records = parseInputRecords(raw, inputPath);

  const [videos, overrides, lock, aiScores] = await Promise.all([
    readJson(VIDEOS_PATH),
    readJson(OVERRIDES_PATH, { schemaVersion: 1, videos: {} }),
    readJson(LOCK_PATH),
    readJson(AI_SCORES_PATH, { schemaVersion: 1, model: "gemini-flash-latest", promptVersion: PROMPT_VERSION, scoreSince: "2026-11-28T00:00:00Z", updatedAt: null, usage: {}, videos: {} }),
  ]);

  const res = importAiScores({
    records,
    videos,
    overrides,
    lock,
    aiScores,
    overwrite: opts.overwrite,
    dryRun: opts.dryRun,
  });

  if (opts.dryRun) {
    console.log("dry-run: no files written.");
  } else if (res.changed) {
    const tmpPath = `${AI_SCORES_PATH}.tmp`;
    await writeFile(tmpPath, res.text, "utf8");
    await rename(tmpPath, AI_SCORES_PATH);
    console.log("wrote data/ai-scores.json");
  } else {
    console.log("no changes; data/ai-scores.json untouched.");
  }
}

const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().catch((e) => {
    console.error("fatal:", e?.message ?? e);
    process.exit(1);
  });
}
