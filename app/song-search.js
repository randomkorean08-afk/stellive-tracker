import { h, clear, fmt1, STATUS_LABELS, add } from "./dom.js";
import { state } from "./store.js";
import { CATEGORIES } from "../lib/derive.mjs";
import { CATEGORY_FILTERS, SORT_OPTIONS, filterSongs, sortSongs, formatDateOnly, formatViews } from "../lib/song-search.mjs";

const filters = { member: "", query: "", category: "", sort: "newest" }; // music only (counted); no hidden toggle
const catLabel = (k) => CATEGORIES.find((c) => c.key === k)?.label ?? k;

/**
 * Build the member song search section for the scorecard dashboard.
 * Uses deriveAll() output (d.videoRows and d.memberCards) directly.
 */
export function songSearchSection(d) {
  const memberNames = new Map((state.repo?.channels?.channels ?? []).map((c) => [c.key, c.displayName]));
  const out = h("div", { class: "song-results" });

  function renderList() {
    const altTitles = Object.fromEntries(Object.entries(state.repo?.videos?.videos ?? {}).map(([id, v]) => [id, v.previousTitles ?? []]));
    const views = Object.fromEntries(Object.entries(state.repo?.videos?.videos ?? {}).filter(([, v]) => typeof v.viewCount === "number").map(([id, v]) => [id, v.viewCount]));
    const rows = sortSongs(filterSongs(d.videoRows, { ...filters, altTitles }), filters.sort, views);
    clear(out);
    add(out, h("p", { class: "muted small song-count" }, `검색 결과 ${rows.length}곡`));
    if (!rows.length) {
      add(out, h("p", { class: "muted small" }, "조건에 맞는 곡이 없습니다."));
      return;
    }
    add(out, 
      h("ul", { class: "song-list" }, rows.map((r) => {
        const ytUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(r.videoId)}`;
        const faded = r.excluded || r.status === "deleted" || r.status === "private";
        const showStatus = r.status === "deleted" || r.status === "private";
        return h("li", { class: `song-row${faded ? " faded" : ""}` },
          h("div", { class: "song-main" },
            h("div", { class: "vtitle" }, r.title),
            h("div", { class: "chips" },
              r.members.length
                ? r.members.map((m) => h("span", { class: "chip" }, memberNames.get(m) ?? m))
                : h("span", { class: "chip warn" }, "멤버 없음")),
            h("div", { class: "song-meta small muted" },
              `${catLabel(r.category)} · ${formatDateOnly(r.publishedAt)}${formatViews(views[r.videoId]) ? ` · 조회수 ${formatViews(views[r.videoId])}` : ""}`,
              r.songScore !== null ? h("span", { class: "badge" }, `점수 ${fmt1(r.songScore)}`) : null,
              r.needsReview ? h("span", { class: "badge warn" }, "검토 대기") : null,
              r.excluded ? h("span", { class: "badge" }, "제외") : null,
              showStatus ? h("span", { class: `badge st-${r.status}` }, STATUS_LABELS[r.status] ?? r.status) : null,
            ),
          ),
          h("a", { class: "yt-link small", href: ytUrl, target: "_blank", rel: "noopener" }, "YouTube ↗"),
        );
      })),
    );
  }

  const controls = h("div", { class: "filters" },
    h("label", {}, "멤버 ",
      h("select", { "aria-label": "멤버 선택", onchange: (e) => { filters.member = e.target.value; renderList(); } },
        h("option", { value: "", selected: filters.member === "" }, "전체"),
        d.memberCards.map((c) => h("option", { value: c.key, selected: filters.member === c.key }, c.displayName)))),
    h("label", {}, "카테고리 ",
      h("select", { "aria-label": "카테고리 선택", onchange: (e) => { filters.category = e.target.value; renderList(); } },
        CATEGORY_FILTERS.map((c) => h("option", { value: c.key, selected: filters.category === c.key }, c.label)))),
    h("label", {}, "정렬 ",
      h("select", { "aria-label": "정렬", onchange: (e) => { filters.sort = e.target.value; renderList(); } },
        SORT_OPTIONS.map((o) => h("option", { value: o.key, selected: filters.sort === o.key }, o.label)))),
    h("label", {}, "곡 검색 ",
      h("input", { type: "search", value: filters.query, placeholder: "곡명 입력…", "aria-label": "곡 키워드 검색",
        oninput: (e) => { filters.query = e.target.value; renderList(); } })),
  );

  renderList();
  return h("section", { class: "card song-search", "aria-label": "멤버 곡 검색" },
    h("h2", {}, "멤버 곡 검색"),
    controls,
    out,
  );
}
