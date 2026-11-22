// Automatic classification. Contract: docs/classification-rules.md. Browser + Node compatible.
// Principle: when unsure, return `unknown` (review queue) instead of guessing.

const norm = (s) => String(s ?? "").normalize("NFKC").toLowerCase();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tokSource = (kw) => `(?<![\\p{L}\\p{N}])${esc(kw)}(?![\\p{L}\\p{N}])`;
const tokRe = (kw) => new RegExp(tokSource(kw), "iu");
const hasAny = (list, text) => list.some((kw) => tokRe(norm(kw)).test(text));

const PROTECTED = ["stellive", "스텔라이브"];

const KW = {
  SHORT: ["#shorts", "shorts", "쇼츠"],
  STREAM: ["노래방송", "노래 방송", "歌枠", "utawaku", "karaoke", "다시보기"],
  CLIP: ["클립", "clip", "하이라이트", "highlight"],
  SONG_CTX: ["노래", "노래방송", "歌", "歌枠", "song", "karaoke", "cover", "커버"],
  LIVE_STRONG: [
    "3d live", "3d 라이브", "live clip", "라이브 클립", "live ver", "live stage",
    "무보정 라이브", "방종 라이브", "concert clip", "콘서트 클립",
  ],
  LIVE_WEAK: ["live", "라이브", "3d", "무대", "콘서트", "concert", "무보정"],
  ORIGINAL: [
    "official mv", "official audio", "official music video", "mv", "m/v",
    "오리지널", "original", "ost", "acoustic ver",
  ],
  COVER: ["cover", "커버", "歌ってみた", "불러보았다"],
};

const NON_MEMBER_REVIEW = new Set(["non_music", "excluded_stream", "excluded_short"]);

// COLLAB_SEP adjacency (applied to short, name-only aliases)
const SEP = "(?:x|×|with|w\\.|feat\\.?)";
const BEFORE_SEP = new RegExp(`(?:^|\\s)(?:${SEP}|&)\\s*$`, "u");
const AFTER_SEP = new RegExp(`^(?:\\s+${SEP}(?=\\s|$)|\\s*&)`, "u");

function spansOf(text, alias) {
  const re = new RegExp(tokSource(alias), "giu");
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push([m.index, m.index + m[0].length]);
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

function dateOf(publishedAt) {
  return typeof publishedAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(publishedAt)
    ? publishedAt.slice(0, 10)
    : null;
}

/**
 * @param {{title:string, channelKey:string|null, publishedAt?:string}} input
 * @param {{units?:any[], channels:any[]}} lock
 * @param {{graduatedAt?:Record<string,string|null>, joinedAt?:Record<string,string|null>}} [ctx]
 */
export function classify(input, lock, ctx = {}) {
  const { title, channelKey = null, publishedAt = null, isShort = null } = input; // isShort: verified YouTube format (collector)
  const text = norm(title);
  let prot = text;
  for (const w of PROTECTED) prot = prot.split(norm(w)).join(" ");

  const channels = lock?.channels ?? [];
  const units = lock?.units ?? [];
  const memberChannels = channels.filter((c) => c.type === "member");
  const uploader = channels.find((c) => c.key === channelKey) ?? null;
  // 업로더가 귀속되는 멤버: member 채널은 자기 자신, member-sub(예: 음악 전용 채널)은 memberKey의 멤버.
  const ownerMember =
    uploader?.type === "member" ? uploader
    : uploader?.type === "member-sub" ? memberChannels.find((c) => c.key === uploader.memberKey) ?? null
    : null;
  // group-sub(예: Topic 채널)은 그룹 확장 판단에서 그룹 채널과 동일하게 취급.
  const uploaderIsGroup = uploader?.type === "group" || uploader?.type === "group-sub";
  const date = dateOf(publishedAt);
  const gradOf = (c) => (ctx.graduatedAt && c.key in ctx.graduatedAt ? ctx.graduatedAt[c.key] : c.graduatedAt) ?? null;
  const joinOf = (c) => (ctx.joinedAt && c.key in ctx.joinedAt ? ctx.joinedAt[c.key] : c.joinedAt) ?? null;

  // ---- category (decision order R10 -> R90) ----
  const has = Object.fromEntries(Object.entries(KW).map(([k, v]) => [k, hasAny(v, prot)]));
  let category, rule;
  const reasons = [];
  if (isShort === true) [category, rule] = ["excluded_short", "R05-short-format"];
  else if (has.SHORT) [category, rule] = ["excluded_short", "R10-short"];
  else if (has.STREAM && !has.CLIP) [category, rule] = ["excluded_stream", "R20-stream"];
  else if (has.CLIP && has.SONG_CTX) [category, rule] = ["live_special", "R25-song-highlight"];
  else if (has.LIVE_STRONG) [category, rule] = ["live_special", "R30-live"];
  else if (has.ORIGINAL) {
    [category, rule] = ["original", "R35-original"];
    if (has.COVER) reasons.push("category_conflict");
  } else if (has.COVER) [category, rule] = [null, null]; // R40/R41 decided after member detection
  else if (has.LIVE_WEAK) {
    [category, rule] = ["unknown", "R50-weak-live"];
    reasons.push("weak_live_token");
  } else [category, rule] = ["non_music", "R90-none"];

  const memberRelevant = !(category && NON_MEMBER_REVIEW.has(category));

  // ---- member detection ----
  const found = new Set();
  if (ownerMember) found.add(ownerMember.key);

  const fullSpans = [];
  const shortCands = [];
  for (const c of memberChannels) {
    for (const raw of c.aliases ?? []) {
      const alias = norm(raw);
      if (!alias) continue;
      const isFull = /\s/.test(alias);
      for (const span of spansOf(text, alias)) {
        if (isFull) {
          found.add(c.key);
          fullSpans.push(span);
        } else shortCands.push({ key: c.key, span });
      }
    }
  }
  for (const { key, span } of shortCands) {
    if (fullSpans.some(([s, e]) => span[0] >= s && span[1] <= e)) continue;
    if (BEFORE_SEP.test(text.slice(0, span[0])) || AFTER_SEP.test(text.slice(span[1]))) found.add(key);
  }

  if (memberRelevant) {
    // unit expansion
    for (const u of units) {
      if ((u.aliases ?? []).some((a) => tokRe(norm(a)).test(text))) {
        for (const c of memberChannels) if (c.unit === u.key) found.add(c.key);
        reasons.push("unit_expansion");
      }
    }
    // group expansion: group channel upload, group alias used, nobody detected
    const groupAlias = channels
      .filter((c) => c.type === "group")
      .some((c) => (c.aliases ?? []).some((a) => tokRe(norm(a)).test(text)));
    if (found.size === 0 && uploaderIsGroup && groupAlias) {
      for (const c of memberChannels) {
        const j = joinOf(c);
        const g = gradOf(c);
        if (date && j && j > date) continue;
        if (date && g && date > g) continue;
        found.add(c.key);
      }
      reasons.push("group_expansion");
    }
  }

  const order = new Map(channels.map((c, i) => [c.key, i]));
  const members = [...found].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));

  // ---- R40 / R41 ----
  if (category === null) {
    if (members.length >= 2) [category, rule] = ["collab_cover", "R41-collab"];
    else [category, rule] = ["solo_cover", "R40-cover"];
  }

  const eligible = !NON_MEMBER_REVIEW.has(category);
  if (eligible) {
    if (members.length === 0) {
      reasons.push("no_member_detected");
      if (!uploader) reasons.push("unknown_channel");
    }
    // 졸업 판정은 귀속 멤버 기준(본채널·음악 전용 채널 모두 적용)
    const g = ownerMember ? gradOf(ownerMember) : null;
    if (g && date && date > g) reasons.push("post_graduation_upload");
  } else {
    // non_music / excluded_*: never carry member-related review reasons
    for (let i = reasons.length - 1; i >= 0; i--) {
      if (["unit_expansion", "group_expansion", "no_member_detected", "unknown_channel", "post_graduation_upload"].includes(reasons[i]))
        reasons.splice(i, 1);
    }
  }

  const reviewReasons = [...new Set(reasons)];
  const reviewRequired = reviewReasons.some((r) => r !== "unit_expansion");
  return { category, members, matchedRules: [rule], reviewRequired, reviewReasons };
}
