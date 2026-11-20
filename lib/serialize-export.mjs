// Order- and style-preserving serialization of ratings.json / overrides.json for export.
// Browser + Node compatible (no Node imports). Goal: exporting an unchanged draft reproduces the
// repo file byte for byte, and a one-value change yields a one-line git diff.
//
// On-disk style (data/ratings.json): 2-space indent; top-level keys in file order; memberRubric and
// videoRatings hold ONE ENTRY PER LINE (4-space indent), each entry inline `{ "k": v, "k2": v2 }`
// (empty object `{}`); every score is written with one decimal (`9.0`, `4.0`), which JSON.parse cannot preserve; memberRubric keys are padded so the `{` columns align. LF, no BOM, trailing "\n".
// data/overrides.json: plain JSON.stringify(_, null, 2) + "\n" in file key order.
import { RUBRIC_ITEMS, VIDEO_ITEMS } from "./derive.mjs";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return false;
}

const idx = (list, k) => { const i = list.indexOf(k); return i < 0 ? Infinity : i; };
const byOrder = (list) => (a, b) => idx(list, a) - idx(list, b) || (a < b ? -1 : a > b ? 1 : 0);

/**
 * Rebuild `next` with key order taken from `orig`: keys already in `orig` keep their position, new
 * keys are appended (ordered by `rank(path)` list if given, else sorted). Recurses into objects.
 * `rankFor(pathArray)` returns a preferred key list for new keys at that path.
 */
function reorder(orig, next, rankFor, p = []) {
  if (!isObj(next)) return next;
  const o = isObj(orig) ? orig : {};
  const out = {};
  for (const k of Object.keys(o)) if (k in next) out[k] = reorder(o[k], next[k], rankFor, [...p, k]);
  const added = Object.keys(next).filter((k) => !(k in o)).sort(byOrder(rankFor(p)));
  for (const k of added) out[k] = reorder(undefined, next[k], rankFor, [...p, k]);
  return out;
}

// Preferred order for NEW keys. path is relative to the section (memberRubric / videoRatings).
const MEMBER_ENTRY = ["items", "ratedAt", "source", "note"];
const VIDEO_ENTRY = ["songScore", "members", "ratedAt", "note"];
const rubricKeys = RUBRIC_ITEMS.map((i) => i.key);
const videoKeys = VIDEO_ITEMS.map((i) => i.key);
const rankMember = (p) => (p.length === 1 ? MEMBER_ENTRY : p.length === 2 && p[1] === "items" ? rubricKeys : []);
const rankVideo = (p) => (p.length === 1 ? VIDEO_ENTRY : p.length === 3 && p[1] === "members" ? videoKeys : []);

/** `{ "a": 1, "b": { "c": 2 } }` — single-line JSON in the repo's spacing style. */
export function inline(v) {
  if (Array.isArray(v)) return v.length ? `[${v.map(inline).join(", ")}]` : "[]";
  if (isObj(v)) {
    const ks = Object.keys(v);
    return ks.length ? `{ ${ks.map((k) => `${JSON.stringify(k)}: ${inline(v[k])}`).join(", ")} }` : "{}";
  }
  if (typeof v === "number" && Number.isInteger(v)) return v.toFixed(1); // scores are 1-decimal on disk (9.0, not 9)
  return JSON.stringify(v);
}

/** One entry per line; `align` pads keys to the longest (as memberRubric is on disk). */
function entryBlock(obj, align) {
  const ks = Object.keys(obj);
  if (!ks.length) return "{}";
  const w = align ? Math.max(...ks.map((k) => JSON.stringify(k).length)) : 0;
  const lines = ks.map((k, i) => {
    const key = `${JSON.stringify(k)}:`;
    return `    ${align ? key.padEnd(w + 1) : key} ${inline(obj[k])}${i < ks.length - 1 ? "," : ""}`;
  });
  return `{\n${lines.join("\n")}\n  }`;
}

/** Merge section: repo order first (unchanged entries reused verbatim), new entries appended. */
function section(baseSec, mergedSec, rankFor) {
  const base = baseSec ?? {};
  const out = {};
  for (const k of Object.keys(base)) if (k in mergedSec) out[k] = deepEqual(base[k], mergedSec[k]) ? base[k] : reorder(base[k], mergedSec[k], (p) => rankFor([k, ...p]), []);
  for (const k of Object.keys(mergedSec).filter((x) => !(x in base)).sort()) out[k] = reorder(undefined, mergedSec[k], (p) => rankFor([k, ...p]), []);
  return out;
}

/**
 * base: repo ratings doc as loaded; merged: {memberRubric, videoRatings} (draft applied);
 * meta: {exportedAt, disclaimer} used when the repo doc lacks them / for the timestamp.
 */
export function serializeRatings(base, merged, meta) {
  const b = base ?? {};
  const doc = {};
  for (const k of Object.keys(b)) doc[k] = b[k];
  doc.schemaVersion ??= 1;
  doc.disclaimer ??= meta.disclaimer;
  doc.exportedAt = meta.exportedAt;
  const order = ["schemaVersion", "disclaimer", "exportedAt", "memberRubric", "videoRatings"];
  const keys = [...Object.keys(b), ...order.filter((k) => !(k in b))];
  const parts = keys.map((k) => {
    if (k === "memberRubric") return `  "memberRubric": ${entryBlock(section(b.memberRubric, merged.memberRubric, (p) => rankMember(p)), true)}`;
    if (k === "videoRatings") return `  "videoRatings": ${entryBlock(section(b.videoRatings, merged.videoRatings, (p) => rankVideo(p)), false)}`;
    return `  ${JSON.stringify(k)}: ${JSON.stringify(doc[k])}`;
  });
  return `{\n${parts.join(",\n")}\n}\n`;
}

export function serializeOverrides(base, merged) {
  const b = base ?? {};
  const videos = section(b.videos, merged.videos ?? {}, () => []);
  const res = {};
  for (const k of Object.keys(b)) res[k] = k === "videos" ? videos : b[k];
  if (!("schemaVersion" in res)) res.schemaVersion = 1;
  if (!("videos" in res)) res.videos = videos;
  if (merged._note && !("_note" in res)) res._note = merged._note;
  return JSON.stringify(res, null, 2) + "\n";
}
