import { h, clear, DISCLAIMER, add } from "./dom.js";
import { loadAll, state, subscribe, dirtyCount, discardDraft, discardCount, storageOk } from "./store.js";
import { renderStaleNotice, confirmDiscard } from "./stale-notice.js";
import { renderScorecard } from "./scorecard.js";
import { renderArchive } from "./archive.js";
import { renderScoring, selectVideo } from "./scoring.js";
import { renderReview } from "./review.js";
import { renderBaseline } from "./baseline.js";
import { renderExport } from "./exporter.js";

const TABS = [
  ["scorecard", "스코어카드"],
  ["archive", "영상 아카이브"],
  ["scoring", "채점"],
  ["review", "검토 큐"],
  ["baseline", "기준선 대조"],
  ["export", "내보내기"],
];
let current = "scorecard";

function show(tab) {
  current = tab;
  const root = document.getElementById("view");
  document.querySelectorAll("[role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  const rerender = () => show(tab);
  const open = (id) => { selectVideo(id); show("scoring"); };
  try {
    if (tab === "scorecard") renderScorecard(root);
    else if (tab === "archive") renderArchive(root, open);
    else if (tab === "scoring") renderScoring(root);
    else if (tab === "review") renderReview(root, rerender);
    else if (tab === "baseline") renderBaseline(root);
    else if (tab === "export") renderExport(root, rerender);
  } catch (e) {
    console.error(e);
    add(clear(root), h("p", { class: "warn-text" }, `화면 표시 중 오류: ${e.message}`));
  }
}

function header() {
  const dirty = h("span", { id: "dirty", class: "badge" });
  const refresh = () => { dirty.textContent = `저장 안 된 변경 ${dirtyCount()}건`; dirty.classList.toggle("warn", dirtyCount() > 0); };
  subscribe(refresh);
  refresh();
  const link = h("a", { href: location.href, target: "_blank", rel: "noopener", class: "newwin" }, "새 창에서 열기");
  add(document.getElementById("topbar"), 
    h("h1", {}, "스텔라이브 보컬 트래커"),
    h("span", { class: "muted small" }, `데이터 갱신 ${state.repo.videos.updatedAt ?? "-"}`),
    dirty,
    h("button", { type: "button", class: "small-btn", onclick: () => { if (discardCount() === 0 || confirmDiscard()) { discardDraft(); show(current); } } }, "초안 폐기"),
    link,
  );
  document.getElementById("banner").textContent = DISCLAIMER;
  if (!storageOk) document.getElementById("memwarn").hidden = false;
  const stale = h("div", { id: "stale", class: "stale-warn", role: "alert", hidden: true });
  document.getElementById("view").before(stale);
  const paintStale = () => renderStaleNotice(stale, () => show(current));
  subscribe(paintStale);
  paintStale();
  const tabs = document.getElementById("tabs");
  for (const [k, l] of TABS) add(tabs, h("button", { type: "button", role: "tab", "data-tab": k, onclick: () => show(k) }, l));
}

(async function boot() {
  try {
    await loadAll();
  } catch (e) {
    console.error(e);
    document.getElementById("view").textContent = `데이터를 불러오지 못했습니다: ${e.message}. 정적 서버(http)로 열어야 합니다.`;
    return;
  }
  header();
  show("scorecard");
})();
