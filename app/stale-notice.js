// Warning shown (top banner + export view) while a stale draft is held aside. Offers keep / discard.
import { h, clear } from "./dom.js";
import { state, keepStaleDraft, discardDraft, discardCount } from "./store.js";
import { describeStale } from "../lib/draft-guard.mjs";

export function confirmDiscard() {
  const n = discardCount();
  return window.confirm(`초안 ${n}건이 영구히 사라집니다. 정말 폐기할까요?`);
}

/** Fill `el` with the stale-draft warning (or empty it). `onChange` runs after the user resolves it. */
export function renderStaleNotice(el, onChange) {
  clear(el);
  const st = state.stale;
  el.hidden = !st;
  if (!st) return el;
  el.append(
    h("strong", {}, "⚠ 오래된 초안이 감지되어 적용을 보류했습니다. "),
    describeStale(st.report),
    " 지금은 저장소 값이 표시·내보내기에 사용됩니다. ",
    h("button", { type: "button", class: "small-btn", onclick: () => { keepStaleDraft(); onChange?.(); } }, "초안 값 유지(적용)"),
    h("button", { type: "button", class: "small-btn", onclick: () => { if (confirmDiscard()) { discardDraft(); onChange?.(); } } }, "초안 폐기"),
  );
  return el;
}
