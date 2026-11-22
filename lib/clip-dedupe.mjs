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

/** Same song when the smaller token set is (almost) contained in the larger one. */
export function sameSong(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return false;
  const A = new Set(aTokens);
  const inter = bTokens.filter((w) => A.has(w)).length;
  return inter > 0 && inter / Math.min(A.size, new Set(bTokens).size) >= 0.8;
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
  // union-find over pairs that are the same stage
  const parent = new Map(clips.map((r) => [r.videoId, r.videoId]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const ids = [...info.keys()];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = info.get(ids[i]), b = info.get(ids[j]);
      if (a.mem !== b.mem || !a.mem) continue;
      if (Math.abs(a.t - b.t) > days * DAY) continue;
      if (sameSong(a.tok, b.tok)) parent.set(find(ids[i]), find(ids[j]));
    }
  }
  const groups = new Map();
  for (const id of ids) { const root = find(id); (groups.get(root) ?? groups.set(root, []).get(root)).push(id); }
  const hidden = new Set();
  const rep = new Map(); // repId -> [dupIds]
  for (const g of groups.values()) {
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
