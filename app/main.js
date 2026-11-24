import { h, clear, DISCLAIMER, add, formatKst } from "./dom.js";
import { loadAll, state, subscribe, dirtyCount, discardDraft, discardCount, storageOk } from "./store.js";
import { renderStaleNotice, confirmDiscard } from "./stale-notice.js";
import { renderScorecard } from "./scorecard.js";
import { renderGallery } from "./gallery.js";
import { renderMembers, selectMember } from "./members.js";
import { renderReview } from "./review.js";
import { renderBaseline } from "./baseline.js";
import { renderExport } from "./exporter.js";

// Public viewer: dashboard + song gallery. Curator tools (overrides review, baseline, export) only with ?admin=1.
const ADMIN = new URLSearchParams(location.search).has("admin");
const TABS = [
  ["scorecard", "대시보드"],
  ["gallery", "노래 갤러리"],
  ["members", "멤버별 보기"],
  ...(ADMIN ? [["review", "검토 큐"], ["baseline", "기준선 대조"], ["export", "내보내기"]] : []),
];
let current = "scorecard";

function openMember(key) {
  selectMember(key);
  show("members");
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  window.scrollTo?.({ top: 0, behavior: reduce ? "auto" : "smooth" });
}

function show(tab) {
  current = tab;
  const root = document.getElementById("view");
  document.querySelectorAll("[role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  const rerender = () => show(tab);
  try {
    if (tab === "scorecard") renderScorecard(root, { openMember });
    else if (tab === "gallery") renderGallery(root);
    else if (tab === "members") renderMembers(root);
    else if (tab === "review" && ADMIN) renderReview(root, rerender);
    else if (tab === "baseline" && ADMIN) renderBaseline(root);
    else if (tab === "export" && ADMIN) renderExport(root, rerender);
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
  const brand = h("div", { class: "brand" },
    h("span", { class: "brand-logo", "aria-hidden": "true" }, "♪"),
    h("div", { class: "brand-text" },
      h("h1", { class: "brand-title" }, "STELLIVE ARCHIVE"),
      h("span", { class: "brand-sub" }, "MUSIC DATABASE · 스텔라이브 보컬 트래커"),
    ),
  );
  const right = h("div", { class: "topbar-meta" },
    h("span", { class: "live-pill" }, h("span", { class: "live-dot", "aria-hidden": "true" }), "LIVE DATA"),
    h("span", { class: "muted small updated-at" }, `데이터 갱신 ${formatKst(state.repo.videos.updatedAt)}`),
    ADMIN ? dirty : null,
    ADMIN && h("button", { type: "button", class: "small-btn", onclick: () => { if (discardCount() === 0 || confirmDiscard()) { discardDraft(); show(current); } } }, "초안 폐기"),
    link,
  );
  add(document.getElementById("topbar"), brand, right);
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
