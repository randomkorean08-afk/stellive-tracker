// Pure import validation (browser + Node safe, no Node imports).
// validateImport(doc, ctx) -> { errors: [{path, message}], warnings: [{path, message}] }
// ctx = { schemaVersion, memberKeys: string[], videoIds: string[] | Set<string> }
import { RUBRIC_ITEMS, VIDEO_ITEMS, CATEGORIES } from "./derive.mjs";
import { isValidVideoId } from "./video-id.mjs";

export const CURRENT_SCHEMA_VERSION = 1;
const KNOWN_TOP = new Set(["schemaVersion", "disclaimer", "exportedAt", "memberRubric", "videoRatings", "videos", "_note"]);

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const oneDecimal = (x) => Math.abs(x * 10 - Math.round(x * 10)) < 1e-9;

/** Member keys = channels-lock entries of type "member". */
export function memberKeysFrom(channelsLock) {
  return (channelsLock?.channels ?? []).filter((c) => c.type === "member").map((c) => c.key);
}

function checkNumber(v, min, max, path, errors) {
  if (!isNum(v)) { errors.push({ path, message: "유한한 숫자여야 합니다." }); return; }
  if (v < min || v > max) errors.push({ path, message: `${min}~${max} 범위여야 합니다 (값: ${v}).` });
  else if (!oneDecimal(v)) errors.push({ path, message: "소수점 첫째 자리까지만 허용됩니다." });
}

export function validateImport(doc, ctx = {}) {
  const errors = [];
  const warnings = [];
  const err = (path, message) => errors.push({ path, message });
  const version = ctx.schemaVersion ?? CURRENT_SCHEMA_VERSION;
  const members = new Set(ctx.memberKeys ?? []);
  const videoIds = ctx.videoIds instanceof Set ? ctx.videoIds : new Set(ctx.videoIds ?? []);

  if (!isObj(doc)) { err("$", "최상위 값은 객체여야 합니다."); return { errors, warnings }; }
  if (doc.schemaVersion !== version) err("schemaVersion", `schemaVersion ${version} 파일이 아닙니다 (값: ${JSON.stringify(doc.schemaVersion)}).`);
  for (const k of Object.keys(doc)) if (!KNOWN_TOP.has(k)) warnings.push({ path: k, message: "알 수 없는 최상위 키입니다 (무시됨)." });

  const checkVideoKey = (id, base) => {
    if (!isValidVideoId(id)) { err(`${base}.${id}`, "11자리 영상 ID 형식이 아닙니다."); return false; }
    if (!videoIds.has(id)) { err(`${base}.${id}`, "videos.json에 없는 영상 ID입니다."); return false; }
    return true;
  };

  if (doc.memberRubric !== undefined) {
    if (!isObj(doc.memberRubric)) err("memberRubric", "객체여야 합니다.");
    else for (const [m, entry] of Object.entries(doc.memberRubric)) {
      const p = `memberRubric.${m}`;
      if (!members.has(m)) err(p, "알 수 없는 멤버 키입니다.");
      const items = entry?.items;
      if (!isObj(items)) { err(`${p}.items`, "items 객체가 필요합니다."); continue; }
      for (const [k, v] of Object.entries(items)) {
        const it = RUBRIC_ITEMS.find((r) => r.key === k);
        if (!it) err(`${p}.items.${k}`, "알 수 없는 루브릭 항목입니다.");
        else checkNumber(v, 0, it.max, `${p}.items.${k}`, errors);
      }
    }
  }

  if (doc.videoRatings !== undefined) {
    if (!isObj(doc.videoRatings)) err("videoRatings", "객체여야 합니다.");
    else for (const [id, r] of Object.entries(doc.videoRatings)) {
      const p = `videoRatings.${id}`;
      checkVideoKey(id, "videoRatings");
      if (!isObj(r)) { err(p, "객체여야 합니다."); continue; }
      if (r.songScore !== null && r.songScore !== undefined) checkNumber(r.songScore, 0, 100, `${p}.songScore`, errors);
      if (r.members !== undefined) {
        if (!isObj(r.members)) { err(`${p}.members`, "객체여야 합니다."); continue; }
        for (const [m, items] of Object.entries(r.members)) {
          const mp = `${p}.members.${m}`;
          if (!members.has(m)) err(mp, "알 수 없는 멤버 키입니다.");
          if (!isObj(items)) { err(mp, "객체여야 합니다."); continue; }
          for (const [k, v] of Object.entries(items)) {
            if (!VIDEO_ITEMS.some((i) => i.key === k)) err(`${mp}.${k}`, "알 수 없는 영상 평가 항목입니다.");
            else checkNumber(v, 0, 100, `${mp}.${k}`, errors);
          }
        }
      }
    }
  }

  if (doc.videos !== undefined) {
    const cats = new Set(CATEGORIES.map((c) => c.key));
    if (!isObj(doc.videos)) err("videos", "객체여야 합니다.");
    else for (const [id, o] of Object.entries(doc.videos)) {
      const p = `videos.${id}`;
      checkVideoKey(id, "videos");
      if (!isObj(o)) { err(p, "객체여야 합니다."); continue; }
      if (o.category !== undefined && !cats.has(o.category)) err(`${p}.category`, `유효하지 않은 카테고리입니다 (값: ${JSON.stringify(o.category)}).`);
      if (o.members !== undefined) {
        if (!Array.isArray(o.members)) err(`${p}.members`, "배열이어야 합니다.");
        else o.members.forEach((m, i) => { if (!members.has(m)) err(`${p}.members[${i}]`, "알 수 없는 멤버 키입니다."); });
      }
    }
  }

  if (doc.memberRubric === undefined && doc.videoRatings === undefined && doc.videos === undefined) {
    err("$", "ratings.json 또는 overrides.json 형식이 아닙니다.");
  }
  return { errors, warnings };
}
