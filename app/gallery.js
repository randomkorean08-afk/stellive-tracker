// 노래 갤러리 + 멤버별 보기: song preview & archive viewer (read-only; no manual scoring).
// Shows listed song videos only (official music + 방송노래). Shorts, chat clips, stream VODs, excluded and
// review-pending videos never appear. Same-stage duplicate 방송노래 clips are folded under the most-viewed one.
import { h, clear, fmt1, add } from "./dom.js";
import { derived, state } from "./store.js";
import { CATEGORIES } from "../lib/derive.mjs";
import { CATEGORY_FILTERS, SORT_OPTIONS, filterSongs, sortSongs, formatDateOnly, formatViews } from "../lib/song-search.mjs";
import { collapseDuplicateClips } from "../lib/clip-dedupe.mjs";

export const memberName = (k) => state.repo?.channels?.channels?.find((c) => c.key === k)?.displayName ?? k;
const memberAliases = (k) => {
  const c = state.repo?.channels?.channels?.find((x) => x.key === k);
  return c ? [c.displayName, ...(c.aliases ?? [])] : [];
};
const catLabel = (k) => CATEGORIES.find((c) => c.key === k)?.label ?? k;
const noEvalLabel = (r) => (r.category === "stream_song" ? "방송노래" : r.groupSong ? "단체곡" : null); // 평가 제외 대상
const thumb = (id, q = "hqdefault") => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/${q}.jpg`;

/** Per-view state, kept across re-renders. */
export const newBrowserState = (member = "") => ({ f: { member, category: "", query: "", sort: "newest" }, selectedId: null, playing: false, showDups: false });
const galleryState = newBrowserState();

/** Open a specific video in the gallery preview (e.g. from another tab). */
export function openInGallery(id) { galleryState.selectedId = id; galleryState.playing = false; }

/**
 * Song browser: preview + filters + card grid. opts.fixedMember locks the member filter (멤버별 보기);
 * group songs then appear only if that member is in the song's members array.
 */
export function renderSongBrowser(root, st, { fixedMember = null, precomputed = null, note = null } = {}) {
  const d = derived();
  const vids = state.repo?.videos?.videos ?? {};
  const views = {};
  const altTitles = {};
  for (const [id, v] of Object.entries(vids)) {
    if (typeof v.viewCount === "number") views[id] = v.viewCount;
    if (v.previousTitles?.length) altTitles[id] = v.previousTitles;
  }
  const cardOf = new Map(d.memberCards.map((c) => [c.key, c]));
  const rowOf = new Map(d.videoRows.map((r) => [r.videoId, r]));
  if (fixedMember) st.f.member = fixedMember;

  const preview = h("section", { class: "card preview", "aria-live": "polite" });
  const count = h("p", { class: "muted small" });
  const grid = h("div", { class: "gallery" });

  const metaLine = (r) => {
    const v = formatViews(views[r.videoId]);
    return `${catLabel(r.category)} · ${formatDateOnly(r.publishedAt)}${v ? ` · 조회수 ${v}` : ""}`;
  };

  function paintPreview() {
    clear(preview);
    const r = st.selectedId ? rowOf.get(st.selectedId) : null;
    if (!r || !(r.listed ?? r.counted)) { add(preview, h("p", { class: "muted" }, "아래 목록에서 노래 영상을 선택하면 여기에서 미리 볼 수 있습니다.")); return; }
    const id = r.videoId;
    const player = st.playing
      ? h("iframe", { class: "player", src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`,
          title: r.title, allow: "autoplay; encrypted-media; picture-in-picture", allowfullscreen: true })
      : h("button", { type: "button", class: "poster", "aria-label": `${r.title} 재생`, onclick: () => { st.playing = true; paintPreview(); } },
          h("img", { alt: "", src: thumb(id, "maxresdefault"), onerror: (e) => { if (!e.target.src.includes("hqdefault")) e.target.src = thumb(id); } }),
          h("span", { class: "play" }, "▶"));
    const ne = noEvalLabel(r);
    const scoreBadges = ne ? [h("span", { class: "badge muted", title: "단체곡·방송노래는 개별 보컬 평가 대상이 아닙니다 (감상·조회수 정렬용)" }, `${ne} · 평가 제외`)] : [];
    const v = vids[id];
    add(preview,
      h("div", { class: `player-wrap${st.playing ? " is-playing" : ""}` }, player),
      h("h3", { class: "ptitle" }, r.title),
      h("div", { class: "chips" }, r.members.map((m) => {
        const c = cardOf.get(m);
        return h("span", { class: "chip", title: c?.rubricTotal != null ? `루브릭 A ${fmt1(c.rubricTotal)} (${c.grade}) · Gemini AI 평가` : null },
          memberName(m), c?.grade ? h("span", { class: "tiny muted" }, ` ${c.grade}`) : null);
      })),
      h("p", { class: "small muted" }, metaLine(r)),
      v?.manual?.uploader ? h("p", { class: "tiny muted" }, `클립 출처: ${v.manual.uploader}${v.manual.song ? ` · 곡: ${v.manual.song}` : ""}`) : null,
      scoreBadges.length ? h("div", { class: "badges" }, scoreBadges) : null,
      h("p", { class: "small" }, h("a", { href: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`, target: "_blank", rel: "noopener" }, "YouTube에서 보기 ↗")),
    );
  }

  function select(id) {
    st.selectedId = id;
    st.playing = false;
    paintPreview();
    for (const el of grid.children) el.classList?.toggle("on", el.dataset?.id === id);
    preview.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }

  function cardBadges(r) {
    const out = [];
    const evalAllowed = !r.groupSong && r.category !== "stream_song";
    if (evalAllowed && r.songScore !== null) out.push(h("span", { class: "badge pill-eval" }, "평가 포함"));
    if (r.category === "stream_song") out.push(h("span", { class: "badge pill-stream" }, "방송노래"));
    if (r.groupSong) out.push(h("span", { class: "badge pill-group" }, "단체곡"));
    if (r.dupCount && !st.showDups) out.push(h("span", { class: "badge pill-dup" }, `같은 무대 클립 +${r.dupCount}`));
    return out;
  }

  function paintGrid() {
    const usePre = precomputed && st.f.category === "" && st.f.query === "";
    const filtered = usePre ? precomputed.allListed : filterSongs(d.videoRows, { ...st.f, altTitles });
    const { rows: collapsed, hidden } = usePre ? precomputed.collapsed : collapseDuplicateClips(filtered, { views, aliasesOf: memberAliases });
    const rows = sortSongs(st.showDups ? filtered : collapsed, st.f.sort, views);
    count.textContent = `노래 영상 ${rows.length}곡${hidden.size ? ` · 같은 무대 중복 클립 ${hidden.size}개 ${st.showDups ? "포함" : "접음"}` : ""}`;
    clear(grid);
    if (!rows.length) { add(grid, h("p", { class: "muted" }, "조건에 맞는 노래 영상이 없습니다.")); return; }
    if (!st.selectedId || !rows.some((r) => r.videoId === st.selectedId)) { st.selectedId = rows[0].videoId; st.playing = false; }
    add(grid, rows.map((r) => {
      const badges = cardBadges(r);
      return h("button", { type: "button", class: `gcard${r.videoId === st.selectedId ? " on" : ""}`, "data-id": r.videoId, onclick: () => select(r.videoId) },
        h("span", { class: "gthumb-wrap" },
          h("img", { class: "gthumb", loading: "lazy", alt: "", src: thumb(r.videoId, "mqdefault") }),
          h("span", { class: "gplay", "aria-hidden": "true" }, "▶"),
        ),
        h("span", { class: "gtitle" }, r.title),
        h("span", { class: "gmembers small" }, r.members.map(memberName).join(", ")),
        h("span", { class: "gmeta tiny muted" }, metaLine(r)),
        badges.length ? h("span", { class: "gbadges" }, badges) : null,
      );
    }));
    paintPreview();
  }

  const controls = h("div", { class: "filters" },
    fixedMember ? null : h("label", {}, "멤버 ",
      h("select", { "aria-label": "멤버", onchange: (e) => { st.f.member = e.target.value; paintGrid(); } },
        h("option", { value: "", selected: st.f.member === "" }, "전체"),
        d.memberCards.map((c) => h("option", { value: c.key, selected: st.f.member === c.key }, c.displayName)))),
    h("label", {}, "카테고리 ",
      h("select", { "aria-label": "카테고리", onchange: (e) => { st.f.category = e.target.value; paintGrid(); } },
        CATEGORY_FILTERS.map((c) => h("option", { value: c.key, selected: st.f.category === c.key }, c.label)))),
    h("label", {}, "정렬 ",
      h("select", { "aria-label": "정렬", onchange: (e) => { st.f.sort = e.target.value; paintGrid(); } },
        SORT_OPTIONS.map((o) => h("option", { value: o.key, selected: st.f.sort === o.key }, o.label)))),
    h("label", {}, "곡 검색 ",
      h("input", { type: "search", value: st.f.query, placeholder: "곡명 입력…", "aria-label": "곡 검색",
        oninput: (e) => { st.f.query = e.target.value; paintGrid(); } })),
    h("label", {},
      h("input", { type: "checkbox", checked: st.showDups, onchange: (e) => { st.showDups = e.target.checked; paintGrid(); } }),
      " 중복 클립 모두 보기"),
  );

  add(root, preview, controls, count, grid, note ? h("p", { class: "tiny muted" }, note) : null);
  paintGrid();
}

export function renderGallery(root) {
  clear(root);
  renderSongBrowser(root, galleryState, {
    note: "노래 영상(개인커버·협동커버·오리지널·3D/라이브)과 방송노래(방송에서 부른 노래 클립)만 표시합니다. 쇼츠·잡담 클립·방송 다시보기·제외/검토 대기 영상은 나오지 않습니다. 같은 멤버가 같은 곡을 3일 이내에 부른 방송노래 클립이 여러 개면 조회수가 가장 높은 1개만 보입니다.",
  });
}
