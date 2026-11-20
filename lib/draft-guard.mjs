// Pure, browser-safe helpers: fingerprint of the repo base a draft was made from, and stale-draft conflict detection.
// No Node-only imports. Nothing here touches storage or the DOM.

const SECTIONS = ["memberRubric", "videoRatings", "overrides"];

export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v === undefined ? null : v);
}

/** Small deterministic string hash (FNV-1a 32-bit, hex). Not cryptographic. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const hashValue = (v) => (v === undefined ? null : hashString(canonical(v)));

/** Fingerprint of the repo ratings/overrides. `keys` holds a per-key value hash used to find changed keys later. */
export function fingerprintRepo(ratings, overrides) {
  const per = (obj) => Object.fromEntries(Object.entries(obj ?? {}).map(([k, v]) => [k, hashValue(v)]));
  return {
    hash: hashString(canonical({ r: ratings ?? null, o: overrides ?? null })),
    ratingsAt: ratings?.exportedAt ?? null,
    overridesAt: overrides?.updatedAt ?? null,
    keys: {
      memberRubric: per(ratings?.memberRubric),
      videoRatings: per(ratings?.videoRatings),
      overrides: per(overrides?.videos),
    },
  };
}

/** Draft entries by section: [{section, key}] (tombstones included). */
export function draftEntries(draft) {
  const src = {
    memberRubric: draft?.ratings?.memberRubric,
    videoRatings: draft?.ratings?.videoRatings,
    overrides: draft?.overrides?.videos,
  };
  return SECTIONS.flatMap((section) => Object.keys(src[section] ?? {}).map((key) => ({ section, key })));
}

export const countDraftEntries = (draft) => draftEntries(draft).length;

/**
 * Compare a draft against the current repo fingerprint.
 * Returns { stale, unknownBase, entryCount, conflicts: [{section,key}] }.
 * - empty draft: never stale (nothing to lose)
 * - no base recorded (old draft): stale + unknownBase; conflicts = draft keys that also exist in the repo
 * - base differs: stale; conflicts = draft keys whose repo value changed since the draft's base
 */
export function detectDraftConflicts(draft, currentFp) {
  const entries = draftEntries(draft);
  const base = draft?.base ?? null;
  if (!entries.length) return { stale: false, unknownBase: false, entryCount: 0, conflicts: [] };
  if (!base || typeof base.hash !== "string") {
    const conflicts = entries.filter((e) => e.key in (currentFp.keys[e.section] ?? {}));
    return { stale: true, unknownBase: true, entryCount: entries.length, conflicts };
  }
  if (base.hash === currentFp.hash) return { stale: false, unknownBase: false, entryCount: entries.length, conflicts: [] };
  const conflicts = entries.filter((e) => (base.keys?.[e.section]?.[e.key] ?? null) !== (currentFp.keys[e.section]?.[e.key] ?? null));
  return { stale: true, unknownBase: false, entryCount: entries.length, conflicts };
}

/** Korean warning text for a detectDraftConflicts() result. */
export function describeStale(report) {
  const n = report.conflicts.length;
  if (report.unknownBase) {
    return `초안(${report.entryCount}건)이 어떤 저장소 버전 기준인지 알 수 없습니다. 저장소에 이미 있는 항목과 겹치는 초안 항목은 ${n}건입니다.`;
  }
  return `초안(${report.entryCount}건)을 만든 뒤 저장소의 ratings/overrides가 바뀌었습니다. 저장소 값이 바뀐 항목과 겹치는 초안 항목은 ${n}건입니다.`;
}
