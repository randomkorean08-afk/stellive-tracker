import { h, clear, REASON_LABELS, add } from "./dom.js";
import { derived, state, setOverride, mergedOverrides } from "./store.js";
import { CATEGORIES } from "../lib/derive.mjs";
import { memberName } from "./archive.js";

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

export function renderReview(root, rerender) {
  clear(root);
  const d = derived();
  const members = state.repo.channels.channels.filter((c) => c.type === "member");
  add(root, h("p", { class: "muted" }, `검토 대기 ${d.reviewQueue.length}건. 카테고리·멤버를 고르면 overrides 초안에 추가되고, 내보내기 탭에서 overrides.json으로 내보냅니다.`));
  if (!d.reviewQueue.length) add(root, h("p", {}, "검토할 영상이 없습니다."));
  for (const id of d.reviewQueue) {
    const row = d.videoRows.find((r) => r.videoId === id);
    const video = state.repo.videos.videos[id];
    const ov = mergedOverrides().videos[id] ?? {};
    const catSel = h("select", {}, CATEGORIES.map((c) => h("option", { value: c.key, selected: c.key === row.category }, c.label)));
    const chosen = new Set(row.members);
    const boxes = members.map((m) =>
      h("label", { class: "chk" }, h("input", { type: "checkbox", checked: chosen.has(m.key), onchange: (e) => (e.target.checked ? chosen.add(m.key) : chosen.delete(m.key)) }), m.displayName));
    const exclude = h("input", { type: "checkbox", checked: ov.exclude === true });
    const note = h("input", { type: "text", value: ov.note ?? "", placeholder: "메모(선택)" });
    const apply = () => {
      const entry = { reviewed: true };
      const auto = video.auto;
      if (catSel.value !== auto.category) entry.category = catSel.value;
      const picked = [...chosen];
      if (!sameSet(picked, auto.members)) entry.members = members.map((m) => m.key).filter((k) => chosen.has(k));
      if (exclude.checked) entry.exclude = true;
      if (note.value.trim()) entry.note = note.value.trim();
      setOverride(id, entry);
      rerender();
    };
    add(root, h("article", { class: "card review-item", "data-id": id },
      h("strong", {}, row.title),
      h("div", { class: "small muted" }, `${id} · ${row.publishedAt ?? "-"} · 자동 분류: ${CATEGORIES.find((c) => c.key === video.auto.category)?.label}`),
      h("div", { class: "chips" }, row.reviewReasons.map((r) => h("span", { class: "chip warn" }, REASON_LABELS[r] ?? r)),
        row.category === "unknown" ? h("span", { class: "chip warn" }, "판단 보류") : null),
      h("div", { class: "form-row" }, h("label", {}, "카테고리 ", catSel), h("label", {}, exclude, " 집계 제외"), note),
      h("details", {}, h("summary", {}, `멤버 (${row.members.map(memberName).join(", ") || "없음"})`), h("div", { class: "chk-grid" }, boxes)),
      h("div", {}, h("button", { type: "button", onclick: apply }, "검토 완료로 적용"), " ",
        id in state.draft.overrides.videos ? h("button", { type: "button", class: "small-btn", onclick: () => { setOverride(id, null); rerender(); } }, "초안 되돌리기") : null)));
  }
}
