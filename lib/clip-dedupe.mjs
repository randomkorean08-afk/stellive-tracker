// Same-stage duplicate clips (browser + Node safe, pure).
// Several clippers often upload the same song from the same stream. Two 방송노래 clips are the same stage when
// they have the same members, the same normalized song name, and upload dates at most `days` (3) apart.
// Only the most-viewed clip of each stage is shown; the rest are folded under it.

// Modifier words that are not part of a song name (whole tokens, after NFKC + lowercase).
const STOP = new Set([
  "노래방송", "노래", "방송", "클립", "clip", "clips", "라이브", "live", "하이라이트", "highlight", "cover", "커버", "covered",
  "full", "풀버전", "풀", "ver", "version", "4k", "1080p", "60fps", "hd", "레전드", "미친", "고음", "컷", "cut", "모음",
  "歌枠", "歌", "歌ってみた", "shorts", "키리누키", "切り抜き", "stellive", "스텔라이브", "vtuber", "버튜버", "무보정",
  "라이브클립", "노래클립", "다시보기", "중", "부른", "불러", "가창", "열창", "sing", "singing", "by", "feat", "ft", "x", "with", "w",
  "lyrics", "가사", "노래방", "편집", "edited", "combined", "연습", "싱크룸", "라이브커버", "solo", "솔로",
  "tokino", "mary", "mery", "merry", "meri", "토키노메리",
]);

/** Normalized song-name tokens: strips hashtags, member names/aliases, brackets/punctuation/emoji and modifiers. */
export function songTokens(title, memberAliases = []) {
  let t = String(title ?? "").normalize("NFKC").toLowerCase();
  t = t.replace(/#[^\s#]+/gu, " ");
  for (const a of [...memberAliases].map((x) => String(x).normalize("NFKC").toLowerCase()).filter(Boolean).sort((x, y) => y.length - x.length)) {
    t = t.split(a).join(" ");
  }
  t = t.replace(/[\p{P}\p{S}]/gu, " ");
  return [...new Set(t.split(/\s+/).filter((w) => w && !STOP.has(w)))];
}

/**
 * Same song when the smaller token set is fully contained in the larger one (strict: artist / channel boilerplate
 * must not make two different songs look alike). A one-token name may only be contained in the other side when it
 * is a Korean/Japanese title of 2+ characters ("만찬가" ⊂ "만찬가 晩餐歌"); a one-token Latin name must match
 * exactly ("King" vs "King Gnu" stay different).
 */
export function sameSong(aTokens, bTokens) {
  const A = new Set(aTokens), B = new Set(bTokens);
  if (!A.size || !B.size) return false;
  const [small, big] = A.size <= B.size ? [A, B] : [B, A];
  if (small.size === 1) {
    const w = [...small][0];
    const cjk = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(w) && [...w].length >= 2;
    return cjk ? big.has(w) : big.size === 1 && big.has(w);
  }
  return [...small].every((w) => big.has(w));
}

const DAY = 86400e3;
const dayOf = (s) => { const t = Date.parse(s ?? ""); return Number.isFinite(t) ? t : null; };

/**
 * Fold same-stage duplicate 방송노래 clips.
 * rows: song rows ({videoId, title, category, members, publishedAt}); views: {videoId: number};
 * aliasesOf(memberKey) -> string[] (names to strip from titles); days: max upload-date gap (default 3).
 * Returns { rows: rows without folded duplicates (representatives get dupCount / dupIds), hidden: Set<videoId> }.
 * Non-clip rows, and clips without a usable date or song name, are never folded.
 */
export function collapseDuplicateClips(rows, { views = {}, aliasesOf = () => [], days = 3 } = {}) {
  const clips = rows.filter((r) => r.category === "stream_song" && dayOf(r.publishedAt) !== null);
  const info = new Map(clips.map((r) => [r.videoId, {
    r, t: dayOf(r.publishedAt), mem: [...r.members].sort().join(","),
    tok: songTokens(r.title, r.members.flatMap((m) => aliasesOf(m))),
  }]));
  // Anchored clustering (no chaining): clips are taken oldest first; a clip joins a stage only if it matches that
  // stage's first clip and the whole stage stays within `days` (so 0d/3d/6d uploads are not merged into one).
  const ordered = [...info.entries()].sort((x, y) => x[1].t - y[1].t || (x[0] < y[0] ? -1 : 1));
  const stages = []; // { anchor, maxT, ids }
  for (const [id, a] of ordered) {
    const st = a.mem && a.tok.length
      ? stages.find((s) => s.anchor.mem === a.mem && a.t - s.anchor.t <= days * DAY && sameSong(s.anchor.tok, a.tok))
      : null;
    if (st) st.ids.push(id);
    else stages.push({ anchor: a, ids: [id] });
  }
  const hidden = new Set();
  const rep = new Map(); // repId -> [dupIds]
  for (const g of stages.map((s) => s.ids)) {
    if (g.length < 2) continue;
    const best = [...g].sort((x, y) => (views[y] ?? -1) - (views[x] ?? -1) || info.get(y).t - info.get(x).t || (x < y ? -1 : 1))[0];
    rep.set(best, g.filter((id) => id !== best));
    for (const id of g) if (id !== best) hidden.add(id);
  }
  const out = [];
  for (const r of rows) {
    if (hidden.has(r.videoId)) continue;
    out.push(rep.has(r.videoId) ? { ...r, dupCount: rep.get(r.videoId).length, dupIds: rep.get(r.videoId) } : r);
  }
  return { rows: out, hidden };
}
