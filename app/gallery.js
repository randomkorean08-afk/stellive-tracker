// 노래 갤러리: music-only preview & archive viewer (read-only; no manual scoring).
// Shows only counted music videos (solo/collab cover, original, live·3D) — Shorts, clips, streams,
// excluded and review-pending videos never appear here.
import { h, clear, fmt1, add } from "./dom.js";
import { derived, state } from "./store.js";
import { CATEGORIES } from "../lib/derive.mjs";
import { CATEGORY_FILTERS, SORT_OPTIONS, filterSongs, sortSongs, formatDateOnly, formatViews } from "../lib/song-search.mjs";

export const memberName = (k) => state.repo?.channels?.channels?.find((c) => c.key === k)?.displayName ?? k;
const catLabel = (k) => CATEGORIES.find((c) => c.key === k)?.label ?? k;
const noEvalLabel = (r) => (r.category === "stream_song" ? "방송노래" : r.groupSong ? "단체곡" : null); // 평가 제외 대상
const thumb = (id, q = "hqdefault") => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/${q}.jpg`;

const f = { member: "", category: "", query: "", sort: "newest" };
let selectedId = null;
let playing = false;

/** Open a specific video in the gallery preview (e.g. from another tab). */
export function openInGallery(id) { selectedId = id; playing = false; }

export function renderGallery(root) {
  clear(root);
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

  const preview = h("section", { class: "card preview", "aria-live": "polite" });
  const count = h("p", { class: "muted small" });
  const grid = h("div", { class: "gallery" });

  function metaLine(r) {
    const v = formatViews(views[r.videoId]);
    return `${catLabel(r.category)} · ${formatDateOnly(r.publishedAt)}${v ? ` · 조회수 ${v}` : ""}`;
  }

  function paintPreview() {
    clear(preview);
    const r = selectedId ? rowOf.get(selectedId) : null;
    if (!r || !r.counted) { add(preview, h("p", { class: "muted" }, "아래 목록에서 노래 영상을 선택하면 여기에서 미리 볼 수 있습니다.")); return; }
    const id = r.videoId;
    const player = playing
      ? h("iframe", { class: "player", src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`,
          title: r.title, allow: "autoplay; encrypted-media; picture-in-picture", allowfullscreen: true })
      : h("button", { type: "button", class: "poster", "aria-label": `${r.title} 재생`, onclick: () => { playing = true; paintPreview(); } },
          h("img", { alt: "", src: thumb(id, "maxresdefault"), onerror: (e) => { if (!e.target.src.includes("hqdefault")) e.target.src = thumb(id); } }),
          h("span", { class: "play" }, "▶"));
    const ne = noEvalLabel(r);
    const scoreBadges = ne ? [h("span", { class: "badge muted", title: "단체곡·방송노래는 개별 보컬 평가 대상이 아닙니다 (감상·조회수 정렬용)" }, `${ne} · 평가 제외`)] : [
      r.songScore !== null ? h("span", { class: "badge" }, `기준 점수 ${fmt1(r.songScore)}`) : null,
      Object.entries(r.memberScores ?? {}).filter(([, s]) => s !== null).map(([m, s]) => h("span", { class: "badge" }, `${memberName(m)} ${fmt1(s)}`)),
    ];
    add(preview,
      h("div", { class: "player-wrap" }, player),
      h("h3", { class: "ptitle" }, r.title),
      h("div", { class: "chips" }, r.members.map((m) => {
        const c = cardOf.get(m);
        return h("span", { class: "chip", title: c?.rubricTotal != null ? `루브릭 A ${fmt1(c.rubricTotal)} (${c.grade}) · 개인 평가` : null },
          memberName(m), c?.grade ? h("span", { class: "tiny muted" }, ` ${c.grade}`) : null);
      })),
      h("p", { class: "small muted" }, metaLine(r)),
      vids[id]?.manual?.uploader ? h("p", { class: "tiny muted" }, `클립 출처: ${vids[id].manual.uploader}${vids[id].manual.song ? ` · 곡: ${vids[id].manual.song}` : ""}`) : null,
      h("div", { class: "badges" }, scoreBadges),
      h("p", { class: "small" }, h("a", { href: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`, target: "_blank", rel: "noopener" }, "YouTube에서 보기 ↗")),
    );
  }

  function select(id) {
    selectedId = id;
    playing = false;
    paintPreview();
    for (const el of grid.children) el.classList?.toggle("on", el.dataset?.id === id);
    preview.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }

  function paintGrid() {
    const rows = sortSongs(filterSongs(d.videoRows, { ...f, altTitles }), f.sort, views);
    count.textContent = `노래 영상 ${rows.length}곡`;
    clear(grid);
    if (!rows.length) { add(grid, h("p", { class: "muted" }, "조건에 맞는 노래 영상이 없습니다.")); return; }
    if (!selectedId || !rows.some((r) => r.videoId === selectedId)) { selectedId = rows[0].videoId; playing = false; }
    add(grid, rows.map((r) => h("button", { type: "button", class: `gcard${r.videoId === selectedId ? " on" : ""}`, "data-id": r.videoId, onclick: () => select(r.videoId) },
      h("img", { class: "gthumb", loading: "lazy", alt: "", src: thumb(r.videoId, "mqdefault") }),
      h("span", { class: "gtitle" }, r.title),
      h("span", { class: "gmembers small" }, r.members.map(memberName).join(", ")),
      h("span", { class: "gmeta tiny muted" }, metaLine(r)),
      noEvalLabel(r) ? h("span", { class: "badge gscore muted" }, noEvalLabel(r)) : r.songScore !== null ? h("span", { class: "badge gscore" }, fmt1(r.songScore)) : null,
    )));
    paintPreview();
  }

  const members = d.memberCards;
  const controls = h("div", { class: "filters" },
    h("label", {}, "멤버 ",
      h("select", { "aria-label": "멤버", onchange: (e) => { f.member = e.target.value; paintGrid(); } },
        h("option", { value: "", selected: f.member === "" }, "전체"),
        members.map((c) => h("option", { value: c.key, selected: f.member === c.key }, c.displayName)))),
    h("label", {}, "카테고리 ",
      h("select", { "aria-label": "카테고리", onchange: (e) => { f.category = e.target.value; paintGrid(); } },
        CATEGORY_FILTERS.map((c) => h("option", { value: c.key, selected: f.category === c.key }, c.label)))),
    h("label", {}, "정렬 ",
      h("select", { "aria-label": "정렬", onchange: (e) => { f.sort = e.target.value; paintGrid(); } },
        SORT_OPTIONS.map((o) => h("option", { value: o.key, selected: f.sort === o.key }, o.label)))),
    h("label", {}, "곡 검색 ",
      h("input", { type: "search", value: f.query, placeholder: "곡명 입력…", "aria-label": "곡 검색",
        oninput: (e) => { f.query = e.target.value; paintGrid(); } })),
  );

  add(root, preview, controls, count, grid,
    h("p", { class: "tiny muted" }, "노래 영상(개인커버·협동커버·오리지널·3D/라이브)과 방송노래(방송에서 부른 노래 클립)만 표시합니다. 쇼츠·잡담 클립·방송 다시보기·제외/검토 대기 영상은 나오지 않습니다. 점수는 기존 기준 데이터(개인 평가)의 읽기 전용 표시이며, 단체곡·방송노래는 평가하지 않습니다."));
  paintGrid();
}
