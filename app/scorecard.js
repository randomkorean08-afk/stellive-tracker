import { h, s, clear, fmt1, add } from "./dom.js";
import { derived, state } from "./store.js";
import { RUBRIC_ITEMS, CATEGORIES } from "../lib/derive.mjs";
import { radarChart, abChart, categoryChart } from "./charts.js";
import { songSearchSection } from "./song-search.js";

let sortMode = "A";
let radarMember = null;

/** Test hook to switch dashboard sort mode ("A" | "B"). */
export function setSortMode(mode) { sortMode = mode === "B" ? "B" : "A"; }

function unitLabel(key) {
  return state.repo.channels.units.find((u) => u.key === key)?.label ?? "";
}

function statIcon(kind) {
  const attrs = { viewBox: "0 0 24 24", width: 18, height: 18, fill: "none", stroke: "currentColor", "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "stat-svg" };
  if (kind === "video") {
    return s("svg", attrs,
      s("rect", { x: 3, y: 4, width: 18, height: 16, rx: 3 }),
      s("polygon", { points: "10,9 16,12 10,15" }),
    );
  }
  if (kind === "members") {
    return s("svg", attrs,
      s("path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }),
      s("circle", { cx: 9, cy: 7, r: 4 }),
      s("path", { d: "M22 21v-2a4 4 0 0 0-3-3.87" }),
      s("path", { d: "M16 3.13a4 4 0 0 1 0 7.75" }),
    );
  }
  if (kind === "music") {
    return s("svg", attrs,
      s("path", { d: "M9 18V5l12-2v13" }),
      s("circle", { cx: 6, cy: 18, r: 3 }),
      s("circle", { cx: 18, cy: 16, r: 3 }),
    );
  }
  return s("svg", attrs,
    s("rect", { x: 5, y: 4, width: 14, height: 17, rx: 2 }),
    s("path", { d: "M9 2h6v4H9z" }),
    s("path", { d: "M9 12l2 2 4-4" }),
  );
}

function heroBanner() {
  return h("section", { class: "card hero" },
    h("span", { class: "hero-eyebrow" }, "WELCOME TO STELLIVE"),
    h("h2", { class: "hero-title" }, "스텔라이브 음악 아카이브"),
    h("p", { class: "hero-sub" }, "멤버들의 음악 활동과 다양한 노래 영상을 한곳에서."),
    h("div", { class: "hero-tags" },
      h("span", { class: "hero-tag tag-music" }, "MUSIC"),
      h("span", { class: "hero-tag tag-archive" }, "ARCHIVE"),
      h("span", { class: "hero-tag tag-stats" }, "STATISTICS"),
    ),
  );
}

function statCard(kind, value, label, sub) {
  return h("div", { class: "stat" },
    h("span", { class: "stat-icon" }, statIcon(kind)),
    h("b", { class: "stat-num" }, value),
    h("span", { class: "stat-label" }, label),
    sub ? h("span", { class: "stat-sub tiny muted" }, sub) : null,
  );
}

function memberCard(c) {
  const bars = RUBRIC_ITEMS.map((it) => {
    const v = c.rubricItems?.[it.key];
    return h(
      "div",
      { class: "bar-row", title: `${it.label} ${fmt1(v ?? null)} / ${it.max}` },
      h("span", { class: "bar-label" }, it.label),
      h("span", { class: "bar-track" }, h("span", { class: `bar-fill ${it.group}`, style: `width:${v == null ? 0 : (v / it.max) * 100}%` })),
      h("span", { class: "bar-val" }, v == null ? "-" : `${fmt1(v)}/${it.max}`),
    );
  });
  const bText =
    c.songAvg === null
      ? "B. 곡 평균 없음 (미채점)"
      : `B. 곡 평균 ${fmt1(c.songAvg)} (${c.songAvgN}곡)`;
  return h(
    "article",
    { class: "card member-card", style: `--accent: var(--c-${c.key})` },
    h(
      "header",
      { class: "card-head" },
      h("span", { class: "rank" }, c.rankA ? `#${c.rankA}` : "-"),
      h("div", {},
        h("strong", { class: "name" }, c.displayName),
        h("div", { class: "muted small" }, unitLabel(c.unit), c.status === "graduated" ? h("span", { class: "badge grad" }, "졸업") : null)),
      h("div", { class: "a-block" },
        h("div", { class: "a-score" }, c.rubricTotal === null ? "-" : fmt1(c.rubricTotal)),
        c.grade ? h("span", { class: `grade g-${c.grade.replace("+", "p")}` }, c.grade) : null),
    ),
    h("p", { class: "small" }, h("strong", {}, "A. 루브릭 총점"), ` (개인 평가) · 물리 ${fmt1(c.physical)}/55 · 해석 ${fmt1(c.interpretive)}/45`),
    h("div", { class: "bars" }, bars),
    h("p", { class: "b-line" }, h("strong", {}, bText),
      c.rankB !== null ? [" ", h("span", { class: "badge" }, `B 순위 #${c.rankB}`)] : null),
    h("p", { class: "slots small" }, "아카이브 슬롯 ",
      CATEGORIES.filter((k) => k.counted).map((k) => h("span", { class: "slot" }, `${k.label} ${c.slots[k.key]}`)),
      h("strong", {}, ` 합계 ${c.slots.total}`)),
    h("p", { class: "small muted" }, `미채점 ${c.unratedCount} · 삭제됨 ${c.deletedCount}`),
    h("p", { class: "tiny muted" }, "A = 멤버 직접 평가(10항목), B = 채점된 영상 평균. 개인 평가."),
  );
}

export function renderScorecard(root) {
  clear(root);
  const d = derived();
  const totalVideos = Object.keys(state.repo?.videos?.videos ?? {}).length;
  const listedSongs = d.videoRows.filter((r) => r.listed).length;
  const reviewN = d.reviewQueue.length;
  add(root,
    heroBanner(),
    h("section", { class: "summary" },
      statCard("video", totalVideos.toLocaleString("en-US"), "전체 영상", "채널 수집 고유 영상"),
      statCard("members", String(d.memberCards.length), "멤버 수", `멤버 슬롯 ${d.totalSlots.toLocaleString("en-US")} · 삭제 ${d.deletedCount}`),
      statCard("music", d.uniqueVideos.toLocaleString("en-US"), "평가 대상 노래", `방송노래 포함 ${listedSongs.toLocaleString("en-US")}곡`),
      statCard("review", String(reviewN), "검토 대기", null),
    ),
    songSearchSection(d),
    h("div", { class: "sort-bar" },
      h("label", { class: "inline" }, "정렬 ",
        h("select", { onchange: (e) => { sortMode = e.target.value; renderScorecard(root); } },
          h("option", { value: "A", selected: sortMode === "A" }, "A 루브릭 순"),
          h("option", { value: "B", selected: sortMode === "B" }, "B 곡 평균 순위")))),
  );
  const cards = sortMode === "B"
    ? d.memberCards.filter((c) => c.rankB !== null).sort((a, b) => a.rankB - b.rankB)
    : d.memberCards;
  add(root, h("div", { class: "grid" }, cards.map(memberCard)));

  radarMember ??= d.memberCards[0]?.key;
  const sel = h("select", { onchange: (e) => { radarMember = e.target.value; renderScorecard(root); } },
    d.memberCards.map((c) => h("option", { value: c.key, selected: c.key === radarMember }, c.displayName)));
  const charts = h("section", { class: "charts" },
    h("h2", {}, "차트 ", h("span", { class: "tag" }, "개인 평가")),
    h("label", { class: "inline" }, "레이더 멤버 ", sel),
    radarChart(d.memberCards.find((c) => c.key === radarMember) ?? d.memberCards[0]),
    abChart(d.memberCards),
    categoryChart(d.memberCards));
  add(root, charts);
}
