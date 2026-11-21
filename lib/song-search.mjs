// Pure song search, normalization, and filtering helpers (browser + Node safe).

export const MUSIC_CATEGORIES = Object.freeze(["solo_cover", "collab_cover", "live_special", "original"]);
const MUSIC_SET = new Set(MUSIC_CATEGORIES);

export const CATEGORY_FILTERS = Object.freeze([
  { key: "", label: "전체" },
  { key: "original", label: "오리지널" },
  { key: "cover", label: "커버" },
  { key: "live_special", label: "라이브·3D" },
]);

const CATEGORY_MAP = {
  original: new Set(["original"]),
  cover: new Set(["solo_cover", "collab_cover"]),
  live_special: new Set(["live_special"]),
  solo_cover: new Set(["solo_cover"]),
  collab_cover: new Set(["collab_cover"]),
};

/**
 * Normalize query or title text for song matching:
 * Unicode NFKC, lowercase, and strip whitespace, brackets, and punctuation/symbols.
 */
export function normalizeQuery(input) {
  return String(input ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

/** Extract YYYY-MM-DD date string from publishedAt, or "-" if missing. */
export function formatDateOnly(publishedAt) {
  const s = String(publishedAt ?? "").trim();
  if (!s) return "-";
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}

const cmpNewestFirst = (a, b) => {
  const pa = a?.publishedAt ?? "";
  const pb = b?.publishedAt ?? "";
  if (pa !== pb) return pa < pb ? 1 : -1;
  const va = a?.videoId ?? "";
  const vb = b?.videoId ?? "";
  return va < vb ? -1 : va > vb ? 1 : 0;
};

/**
 * Filter and sort derived video rows for the dashboard member song search.
 * Pure function: never mutates input rows or options.
 */
export function filterSongs(rows, options = {}) {
  const { member = "", query = "", category = "", includeHidden = false } = options ?? {};
  const nq = normalizeQuery(query);
  let allowedCats = MUSIC_SET;
  if (category && category !== "all") {
    allowedCats = CATEGORY_MAP[category];
    if (!allowedCats) return [];
  }

  const out = [];
  for (const r of rows ?? []) {
    if (!r || !allowedCats.has(r.category)) continue;
    if (!includeHidden && (r.excluded || r.needsReview || r.counted === false)) continue;
    if (member && (!Array.isArray(r.members) || !r.members.includes(member))) continue;
    if (nq && !normalizeQuery(r.title).includes(nq)) continue;
    out.push(r);
  }
  out.sort(cmpNewestFirst);
  return out;
}
