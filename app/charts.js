// Hand-drawn SVG charts (no dependencies). They only draw values produced by lib/derive.mjs.
import { s, h, fmt1 } from "./dom.js";
import { RUBRIC_ITEMS, CATEGORIES } from "../lib/derive.mjs";

export const CAT_COLORS = { solo_cover: "var(--c-solo)", collab_cover: "var(--c-collab)", live_special: "var(--c-live)", original: "var(--c-orig)" };
const COUNTED = CATEGORIES.filter((c) => c.counted);

function title(text) {
  return h("h3", { class: "chart-title" }, text, " ", h("span", { class: "tag" }, "개인 평가"));
}

/** 10-axis radar. Each axis = value / item max (0..1). */
export function radarChart(card) {
  const wrap = h("figure", { class: "chart" }, title(`${card.displayName} 루브릭 레이더`));
  if (!card.rubricItems) {
    wrap.append(h("p", { class: "muted" }, "루브릭 10항목이 모두 입력되지 않아 표시할 수 없습니다."));
    return wrap;
  }
  const size = 320, cx = size / 2, cy = size / 2 + 4, R = 105;
  const n = RUBRIC_ITEMS.length;
  const pt = (i, f) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f];
  };
  const svg = s("svg", { viewBox: `0 0 ${size} ${size + 8}`, role: "img", "aria-label": `${card.displayName} 루브릭 레이더 차트`, class: "svg-chart" });
  for (const f of [0.25, 0.5, 0.75, 1]) {
    svg.append(s("polygon", { class: "gridline", points: RUBRIC_ITEMS.map((_, i) => pt(i, f).join(",")).join(" ") }));
  }
  RUBRIC_ITEMS.forEach((it, i) => {
    const [x, y] = pt(i, 1);
    svg.append(s("line", { class: "gridline", x1: cx, y1: cy, x2: x, y2: y }));
    const [lx, ly] = pt(i, 1.2);
    svg.append(s("text", { class: "axis-label", x: lx, y: ly, "text-anchor": "middle", "dominant-baseline": "middle" }, it.label));
  });
  const pts = RUBRIC_ITEMS.map((it, i) => pt(i, Math.max(0, Math.min(1, card.rubricItems[it.key] / it.max))));
  svg.append(s("polygon", { class: "radar-area", points: pts.map((p) => p.join(",")).join(" ") }));
  RUBRIC_ITEMS.forEach((it, i) => {
    svg.append(
      s("circle", { class: "radar-dot", cx: pts[i][0], cy: pts[i][1], r: 4 }, s("title", {}, `${it.label}: ${fmt1(card.rubricItems[it.key])} / ${it.max}`)),
    );
  });
  wrap.append(svg);
  return wrap;
}

/** Horizontal bars: A (rubric total) and B (song average) per member. */
export function abChart(cards) {
  const wrap = h("figure", { class: "chart" }, title("멤버별 A(루브릭) / B(곡 평균)"));
  const rowH = 38, left = 92, right = 90, W = 560;
  const H = cards.length * rowH + 10;
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "멤버별 A와 B 비교 막대", class: "svg-chart" });
  const scale = (v) => ((W - left - right) * v) / 100;
  cards.forEach((c, i) => {
    const y = i * rowH + 4;
    svg.append(s("text", { class: "axis-label", x: left - 6, y: y + 13, "text-anchor": "end" }, c.displayName));
    if (c.rubricTotal !== null) {
      svg.append(s("rect", { class: "bar-a", x: left, y, width: scale(c.rubricTotal), height: 13 }, s("title", {}, `${c.displayName} A ${fmt1(c.rubricTotal)} (${c.grade})`)));
      svg.append(s("text", { class: "val", x: left + scale(c.rubricTotal) + 4, y: y + 11 }, `A ${fmt1(c.rubricTotal)}`));
    }
    if (c.songAvg !== null) {
      svg.append(s("rect", { class: "bar-b", x: left, y: y + 16, width: scale(c.songAvg), height: 13 }, s("title", {}, `${c.displayName} B ${fmt1(c.songAvg)} (${c.songAvgN}곡)`)));
      svg.append(s("text", { class: "val", x: left + scale(c.songAvg) + 4, y: y + 27 }, `B ${fmt1(c.songAvg)} (${c.songAvgN}곡)`));
    }
    if (c.unratedCount) svg.append(s("text", { class: "val muted-svg", x: W - 4, y: y + 11, "text-anchor": "end" }, `미채점 ${c.unratedCount}`));
  });
  wrap.append(svg, h("p", { class: "legend" }, h("i", { class: "sw sw-a" }), "A 루브릭 ", h("i", { class: "sw sw-b" }), "B 곡 평균 · 미채점 영상은 B에서 제외"));
  return wrap;
}

/** Stacked bars of archive slots per category. */
export function categoryChart(cards) {
  const wrap = h("figure", { class: "chart" }, title("멤버 슬롯 카테고리 구성"));
  const rowH = 24, left = 92, W = 560;
  const max = Math.max(1, ...cards.map((c) => c.slots.total));
  const H = cards.length * rowH + 6;
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "멤버별 카테고리 누적 막대", class: "svg-chart" });
  cards.forEach((c, i) => {
    const y = i * rowH + 3;
    svg.append(s("text", { class: "axis-label", x: left - 6, y: y + 12, "text-anchor": "end" }, c.displayName));
    let x = left;
    for (const cat of COUNTED) {
      const w = ((W - left - 40) * c.slots[cat.key]) / max;
      if (w > 0) {
        svg.append(s("rect", { x, y, width: w, height: 16, fill: CAT_COLORS[cat.key] }, s("title", {}, `${c.displayName} ${cat.label} ${c.slots[cat.key]}`)));
        x += w;
      }
    }
    svg.append(s("text", { class: "val", x: x + 4, y: y + 12 }, String(c.slots.total)));
  });
  const legend = h("p", { class: "legend" }, COUNTED.map((c) => [h("i", { class: "sw", style: `background:${CAT_COLORS[c.key]}` }), `${c.label} `]));
  wrap.append(svg, legend);
  return wrap;
}
