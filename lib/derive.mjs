// Derived calculations (pure functions, inputs never mutated). Contract: docs/schema.md section 6
// and docs/handoff-ui.md section 8. Browser + Node compatible. Nothing here is stored anywhere;
// every number is recomputed from channels / videos / overrides / ratings / baseline.
// Rounding is a display concern: no rounding happens in this module.

export const MIN_RATED = 3;
/** 단체곡(다인원 단체곡·합창곡): effective members >= this. Shown everywhere, but never vocally evaluated (B). */
export const GROUP_SONG_MIN_MEMBERS = 3;
export const isGroupSong = (members) => (members?.length ?? 0) >= GROUP_SONG_MIN_MEMBERS;

export const RUBRIC_ITEMS = Object.freeze([
  { key: "vocalization", label: "발성", max: 15, group: "physical" },
  { key: "pitch", label: "음정", max: 10, group: "physical" },
  { key: "rhythm", label: "리듬", max: 10, group: "physical" },
  { key: "range", label: "음역", max: 10, group: "physical" },
  { key: "volume", label: "성량", max: 10, group: "physical" },
  { key: "tone", label: "음색", max: 10, group: "interpretive" },
  { key: "technique", label: "테크닉", max: 10, group: "interpretive" },
  { key: "expression", label: "표현력", max: 10, group: "interpretive" },
  { key: "breath", label: "호흡", max: 10, group: "interpretive" },
  { key: "live", label: "라이브", max: 5, group: "interpretive" },
].map((o) => Object.freeze(o)));

export const VIDEO_ITEMS = Object.freeze([
  { key: "pitch", label: "음정" },
  { key: "tone", label: "음색" },
  { key: "expression", label: "표현력" },
  { key: "highNotes", label: "고음" },
  { key: "stability", label: "안정성" },
].map((o) => Object.freeze(o)));

export const CATEGORIES = Object.freeze([
  { key: "solo_cover", label: "개인커버", counted: true },
  { key: "collab_cover", label: "협동커버", counted: true },
  { key: "live_special", label: "3D·특수", counted: true },
  { key: "original", label: "오리지널·OST", counted: true },
  // 방송노래: listed in the archive (viewing / view-count sort) but never counted in slots or evaluated (B)
  { key: "stream_song", label: "방송노래", counted: false, listed: true },
  { key: "excluded_stream", label: "노래방송 풀 VOD", counted: false },
  { key: "excluded_short", label: "쇼츠", counted: false },
  { key: "non_music", label: "비음악", counted: false },
  { key: "unknown", label: "판단 보류", counted: false },
].map((o) => Object.freeze(o)));

const MUSIC = new Set(CATEGORIES.filter((c) => c.counted).map((c) => c.key));
const MUSIC_KEYS = CATEGORIES.filter((c) => c.counted).map((c) => c.key);
const LISTED_ONLY = new Set(CATEGORIES.filter((c) => c.listed && !c.counted).map((c) => c.key));
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const hasAllRubricItems = (items) => !!items && RUBRIC_ITEMS.every((it) => isNum(items[it.key]));

/**
 * Blend a member's prior 10-item rubric with AI song scores:
 *   blended_item = (prior_item * K + sum(song_items)) / (K + n)
 * With n === 0 and a valid prior, returns the prior items unchanged.
 * Without a prior, returns the plain mean once n >= 1, else null.
 */
export function blendRubric(priorItems, songItemsList, K = 5) {
  const validSongs = (songItemsList ?? []).filter(hasAllRubricItems);
  const n = validSongs.length;
  const hasPrior = hasAllRubricItems(priorItems);
  if (!hasPrior && n === 0) return null;
  if (hasPrior && n === 0) {
    return Object.fromEntries(RUBRIC_ITEMS.map((it) => [it.key, priorItems[it.key]]));
  }
  const out = {};
  for (const it of RUBRIC_ITEMS) {
    let sum = 0;
    for (const row of validSongs) sum += row[it.key];
    out[it.key] = hasPrior ? (priorItems[it.key] * K + sum) / (K + n) : sum / n;
  }
  return out;
}

export function effective(video, override) {
  const auto = video?.auto ?? {};
  const o = override ?? {};
  return {
    category: o.category ?? auto.category ?? "unknown",
    members: o.members ?? auto.members ?? [],
    excluded: o.exclude === true,
    needsReview: auto.reviewRequired === true && o.reviewed !== true,
  };
}

export function songScore(videoId, ratings) {
  const v = ratings?.videoRatings?.[videoId]?.songScore;
  return isNum(v) ? v : null;
}

export function memberVideoScore(memberKey, videoId, ratings) {
  const m = ratings?.videoRatings?.[videoId]?.members?.[memberKey];
  if (!m) return null;
  let sum = 0;
  for (const it of VIDEO_ITEMS) {
    if (!isNum(m[it.key])) return null; // partial input counts as unrated
    sum += m[it.key];
  }
  return sum / VIDEO_ITEMS.length;
}

export function grade(total) {
  if (!isNum(total)) return null;
  total += 1e-9; // 경계값 부동소수점 보호
  if (total >= 95) return "S+";
  if (total >= 90) return "S";
  if (total >= 85) return "A+";
  if (total >= 80) return "A";
  if (total >= 75) return "B+";
  return "B";
}

const contribution = (m, id, ratings) => memberVideoScore(m, id, ratings) ?? songScore(id, ratings);

function rubricOf(items) {
  if (!items) return { total: null, physical: null, interpretive: null, items: null };
  // 고해상도 정수(1e6 배율)로 합산해 블렌딩된 소수 항목의 정밀도 손실과 부동소수점 오차를 모두 방지한다.
  const SCALE = 1e6;
  const out = {};
  let physT = 0;
  let intT = 0;
  for (const it of RUBRIC_ITEMS) {
    const v = items[it.key];
    if (!isNum(v)) return { total: null, physical: null, interpretive: null, items: null };
    out[it.key] = v;
    const t = Math.round(v * SCALE);
    if (it.group === "physical") physT += t;
    else intT += t;
  }
  return { total: (physT + intT) / SCALE, physical: physT / SCALE, interpretive: intT / SCALE, items: out };
}

const cmpDateDesc = (a, b) => {
  const pa = a.publishedAt ?? "";
  const pb = b.publishedAt ?? "";
  if (pa !== pb) return pa < pb ? 1 : -1;
  return a.videoId < b.videoId ? -1 : a.videoId > b.videoId ? 1 : 0;
};

export function deriveAll({ channels, videos, overrides, ratings, baseline, aiScores } = {}) {
  const memberChannels = (channels?.channels ?? []).filter((c) => c.type === "member");
  const ovMap = overrides?.videos ?? {};
  const hasAi = aiScores !== undefined && aiScores !== null;
  const aiByMember = hasAi ? new Map() : null;

  // ---- per-video rows ----
  const vlist = Object.entries(videos?.videos ?? {}).map(([id, v]) => ({ ...v, videoId: v?.videoId ?? id, _key: id }));
  vlist.sort(cmpDateDesc);
  const videoRows = [];
  const reviewQueue = [];
  const countedList = [];
  for (const v of vlist) {
    const id = v._key;
    const eff = effective(v, ovMap[id]);
    const counted = MUSIC.has(eff.category) && !eff.excluded && !eff.needsReview;
    const listed = counted || (LISTED_ONLY.has(eff.category) && !eff.excluded && !eff.needsReview);
    const memberScores = {};
    for (const m of eff.members) memberScores[m] = memberVideoScore(m, id, ratings);
    videoRows.push({
      videoId: id,
      title: v.title,
      publishedAt: v.publishedAt ?? null,
      status: v.status ?? "unverified",
      category: eff.category,
      members: [...eff.members],
      excluded: eff.excluded,
      needsReview: eff.needsReview,
      reviewReasons: [...(v.auto?.reviewReasons ?? [])],
      songScore: songScore(id, ratings),
      memberScores,
      counted,
      groupSong: isGroupSong(eff.members), // 단체곡: listed, but excluded from evaluation (B)
      // listed: shown in archive/search/viewer (counted music + 방송노래), never excluded/review-pending
      listed,
    });
    if (!eff.excluded && (eff.needsReview || eff.category === "unknown")) reviewQueue.push(id);
    if (counted) countedList.push({ id, status: v.status, members: eff.members, category: eff.category });
    if (aiByMember && listed && v.status !== "deleted" && v.status !== "private" && eff.members.length >= 1 && !isGroupSong(eff.members)) {
      const ai = aiScores.videos?.[id];
      if (ai && !ai.skipped && ai.members) {
        for (const m of eff.members) {
          const items = ai.members[m]?.items;
          if (hasAllRubricItems(items)) {
            let arr = aiByMember.get(m);
            if (!arr) { arr = []; aiByMember.set(m, arr); }
            arr.push(items);
          }
        }
      }
    }
  }

  // ---- member cards ----
  const cards = memberChannels.map((ch) => {
    const priorItems = ratings?.memberRubric?.[ch.key]?.items ?? null;
    const aiSongs = aiByMember ? (aiByMember.get(ch.key) ?? []) : null;
    const r = rubricOf(aiSongs ? blendRubric(priorItems, aiSongs) : priorItems);
    const mine = countedList.filter((c) => c.members.includes(ch.key));
    const slots = Object.fromEntries(MUSIC_KEYS.map((k) => [k, mine.filter((c) => c.category === k).length]));
    slots.total = mine.length;
    // B: 단체곡 is counted in slots but never in the vocal average / rated count
    const evaluable = mine.filter((c) => !isGroupSong(c.members));
    const scores = evaluable.map((c) => contribution(ch.key, c.id, ratings));
    const rated = scores.filter((s) => s !== null);
    const n = rated.length;
    const sum = rated.reduce((a, b) => a + b, 0);
    const unratedCount = evaluable.length - n;
    const groupSongCount = mine.length - evaluable.length;
    const deletedCount = mine.filter((c) => c.status === "deleted").length;
    return {
      key: ch.key,
      displayName: ch.displayName,
      unit: ch.unit ?? null,
      status: ch.status ?? null,
      rubricTotal: r.total,
      physical: r.physical,
      interpretive: r.interpretive,
      rubricItems: r.items,
      grade: grade(r.total),
      rankA: null,
      songAvg: n > 0 ? sum / n : null,
      songAvgN: n,
      rankB: null,
      slots,
      unratedCount,
      groupSongCount,
      deletedCount,
      ...(aiSongs !== null ? { aiSongsN: aiSongs.length } : {}),
    };
  });

  // rankA: A desc -> B desc (null last) -> key
  const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const rankedA = cards.filter((c) => c.rubricTotal !== null).sort((a, b) => {
    if (a.rubricTotal !== b.rubricTotal) return b.rubricTotal - a.rubricTotal;
    if (a.songAvg !== b.songAvg) {
      if (a.songAvg === null) return 1;
      if (b.songAvg === null) return -1;
      return b.songAvg - a.songAvg;
    }
    return byKey(a, b);
  });
  rankedA.forEach((c, i) => (c.rankA = i + 1));

  cards
    .filter((c) => c.songAvgN >= MIN_RATED)
    .sort((a, b) => (a.songAvg !== b.songAvg ? b.songAvg - a.songAvg : byKey(a, b)))
    .forEach((c, i) => (c.rankB = i + 1));

  const memberCards = [...rankedA, ...cards.filter((c) => c.rubricTotal === null).sort(byKey)];

  // ---- baseline diff (display only) ----
  const baselineDiff = {};
  const rc = baseline?.reportedCounts;
  if (rc) {
    for (const card of cards) {
      const base = rc[card.key];
      if (!base) continue;
      const row = {};
      for (const cat of [...MUSIC_KEYS, "total"]) {
        const derived = card.slots[cat];
        const b = isNum(base[cat]) ? base[cat] : null;
        row[cat] = { derived, baseline: b, delta: b === null ? null : derived - b };
      }
      baselineDiff[card.key] = row;
    }
  }

  return {
    uniqueVideos: countedList.length,
    totalSlots: cards.reduce((s, c) => s + c.slots.total, 0),
    deletedCount: countedList.filter((c) => c.status === "deleted").length,
    memberCards,
    videoRows,
    reviewQueue,
    baselineDiff,
  };
}
