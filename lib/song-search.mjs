// Pure song search, normalization, and filtering helpers (browser + Node safe).

export const MUSIC_CATEGORIES = Object.freeze(["solo_cover", "collab_cover", "live_special", "original", "stream_song"]);
const MUSIC_SET = new Set(MUSIC_CATEGORIES);

export const CATEGORY_FILTERS = Object.freeze([
  { key: "", label: "전체" },
  { key: "original", label: "오리지널" },
  { key: "cover", label: "커버" },
  { key: "live_special", label: "라이브·3D" },
  { key: "stream_song", label: "방송노래" },
  { key: "official", label: "정식 투고만" },
]);

const CATEGORY_MAP = {
  original: new Set(["original"]),
  cover: new Set(["solo_cover", "collab_cover"]),
  live_special: new Set(["live_special"]),
  stream_song: new Set(["stream_song"]),
  official: new Set(["solo_cover", "collab_cover", "live_special", "original"]),
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

/** YYYY-MM-DD in Korea time (KST, UTC+9, no DST) for timestamps; date-only strings unchanged; "-" if missing. */
export function formatDateOnly(publishedAt) {
  const s = String(publishedAt ?? "").trim();
  if (!s) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (Number.isFinite(t)) return new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
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
  // altTitles: optional { videoId: string[] } (e.g. videos.json previousTitles) so renamed videos stay findable
  const { member = "", query = "", category = "", includeHidden = false, altTitles = null } = options ?? {};
  const nq = normalizeQuery(query);
  let allowedCats = MUSIC_SET;
  if (category && category !== "all") {
    allowedCats = CATEGORY_MAP[category];
    if (!allowedCats) return [];
  }

  const out = [];
  for (const r of rows ?? []) {
    if (!r || !allowedCats.has(r.category)) continue;
    const visible = r.listed ?? r.counted; // counted music + 방송노래
    if (!includeHidden && (r.excluded || r.needsReview || visible === false)) continue;
    if (member && (!Array.isArray(r.members) || !r.members.includes(member))) continue;
    if (nq && ![r.title, ...(altTitles?.[r.videoId] ?? [])].some((t) => normalizeQuery(t).includes(nq))) continue;
    out.push(r);
  }
  out.sort(cmpNewestFirst);
  return out;
}

/**
 * Korean view-count label: 999 -> "999회", 12,345 -> "1.2만회", 160,000 -> "16만회",
 * 16,000,000 -> "1,600만회", 123,000,000 -> "1.2억회". null/invalid -> null.
 */
export function formatViews(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  const trim = (x) => x.toFixed(1).replace(/.0$/, "");
  if (n < 1e4) return `${Math.floor(n).toLocaleString("en-US")}회`;
  if (n < 1e5) return `${trim(Math.floor(n / 1e3) / 10)}만회`;
  if (n < 1e8) return `${Math.floor(n / 1e4).toLocaleString("en-US")}만회`;
  return `${trim(Math.floor(n / 1e7) / 10)}억회`;
}

export const SORT_OPTIONS = Object.freeze([
  { key: "newest", label: "최신순" },
  { key: "views", label: "조회수순" },
  { key: "score", label: "점수순" },
]);

/** Re-sort filtered rows. views: { videoId: number }. Missing values go last; ties fall back to newest first. */
export function sortSongs(rows, sort = "newest", views = {}) {
  const val = (r) => (sort === "views" ? views?.[r.videoId] : sort === "score" ? (isEvaluated(r) ? r.songScore : undefined) : undefined); // 단체곡·방송노래 = 평가 제외
  const out = [...rows];
  if (sort !== "views" && sort !== "score") return out.sort(cmpNewestFirst);
  return out.sort((a, b) => {
    const va = val(a), vb = val(b);
    const na = typeof va !== "number", nb = typeof vb !== "number";
    if (na !== nb) return na ? 1 : -1;
    if (!na && va !== vb) return vb - va;
    return cmpNewestFirst(a, b);
  });
}

/** Vocal evaluation applies only to official uploads that are not group songs (단체곡/방송노래 = 평가 제외). */
export const isEvaluated = (r) => !r.groupSong && r.category !== "stream_song";

/**
 * Per-member song counts for the 멤버별 보기 summary. rows: that member's listed song rows (after filtering/folding).
 * soloDuet = official uploads with 1-2 members; group = 단체곡 (3+); stream = 방송노래.
 */
export function memberSongSummary(rows) {
  const official = rows.filter((r) => r.category !== "stream_song");
  return {
    total: rows.length,
    soloDuet: official.filter((r) => !r.groupSong).length,
    group: official.filter((r) => r.groupSong).length,
    stream: rows.filter((r) => r.category === "stream_song").length,
  };
}
