import { h, clear, fmt1, add } from "./dom.js";
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
    { class: "card member-card" },
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
  const reviewN = d.reviewQueue.length;
  add(root, 
    h("section", { class: "summary" },
      h("div", { class: "stat" }, h("b", {}, String(d.uniqueVideos)), h("span", {}, "고유 영상 수 (영상 1개 = 1)")),
      h("div", { class: "stat" }, h("b", {}, String(d.totalSlots)), h("span", {}, "멤버 슬롯 합 (참여 멤버마다 1)")),
      h("div", { class: "stat" }, h("b", {}, String(d.deletedCount)), h("span", {}, "삭제됨")),
      h("div", { class: "stat" }, h("b", {}, String(reviewN)), h("span", {}, "검토 필요")),
    ),
    songSearchSection(d),
    h("label", { class: "inline" }, "정렬 ",
      h("select", { onchange: (e) => { sortMode = e.target.value; renderScorecard(root); } },
        h("option", { value: "A", selected: sortMode === "A" }, "A 루브릭 순"),
        h("option", { value: "B", selected: sortMode === "B" }, "B 곡 평균 순위"))),
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
