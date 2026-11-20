import { h, clear } from "./dom.js";
import { derived, state } from "./store.js";
import { CATEGORIES } from "../lib/derive.mjs";

const COUNTED = CATEGORIES.filter((c) => c.counted);

export function renderBaseline(root) {
  clear(root);
  const d = derived();
  const base = state.repo.baseline;
  if (!base) { root.append(h("p", { class: "muted" }, "기준선 파일을 불러오지 못했습니다.")); return; }
  const cols = [...COUNTED.map((c) => [c.key, c.label]), ["total", "합계"]];
  const sign = (n) => (n === null ? "" : n > 0 ? `+${n}` : String(n));
  root.append(
    h("p", { class: "muted" }, "기준선(PDF 2026-11-17)은 참고용 라벨로만 표시하며 계산에는 더해지지 않습니다. 기준선 수치는 멤버 슬롯(참여 멤버마다 1) 기준입니다."),
    h("div", { class: "table-wrap" }, h("table", { class: "diff" },
      h("thead", {}, h("tr", {}, h("th", {}, "멤버"), cols.map(([, l]) => h("th", {}, l, h("br"), h("span", { class: "tiny" }, "계산 / 기준선(참고) / 차이"))))),
      h("tbody", {}, d.memberCards.map((c) => h("tr", {}, h("th", {}, c.displayName),
        cols.map(([k]) => {
          const x = d.baselineDiff[c.key]?.[k];
          if (!x) return h("td", {}, "-");
          return h("td", { class: "num" }, h("b", {}, String(x.derived)), " / ", h("span", { class: "ref" }, x.baseline === null ? "-" : String(x.baseline)), " ",
            h("span", { class: x.delta ? "delta nz" : "delta" }, sign(x.delta)));
        })))))),
    h("p", { class: "small" }, `계산 합계: 고유 영상 ${d.uniqueVideos} · 멤버 슬롯 ${d.totalSlots} / 기준선 슬롯 합 ${base.reportedTotals?.fromTable?.total ?? "-"}(참고)`),
    h("h3", {}, "알려진 불일치 (기준선 문서)"),
    h("ul", {}, (base.knownDiscrepancies ?? []).map((k) => h("li", {}, h("strong", {}, k.id), " ", k.desc, h("div", { class: "small muted" }, `처리: ${k.resolution}`)))),
  );
}
