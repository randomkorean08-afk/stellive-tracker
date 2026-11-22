// Tiny DOM helpers. All text goes through textContent / text nodes (no innerHTML).
const SVG_NS = "http://www.w3.org/2000/svg";
const PROPS = new Set(["value", "checked", "disabled", "selected", "textContent", "htmlFor"]);

/** Safe append: flattens nested arrays and skips null/undefined/false. Never pass arrays to native Element.append. */
export function add(el, ...kids) { append(el, kids); return el; }

function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

function apply(el, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.setAttribute("class", v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (PROPS.has(k) && el.namespaceURI !== SVG_NS) el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
}

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  apply(el, attrs);
  append(el, kids);
  return el;
}

export function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, attrs);
  append(el, kids);
  return el;
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const fmt1 = (x) => (x === null || x === undefined || Number.isNaN(x) ? "-" : (Math.round(x * 10) / 10).toFixed(1));
export const DISCLAIMER = "모든 점수는 큐레이터 개인 평가이며 공식 평가가 아닙니다.";

export const REASON_LABELS = {
  weak_live_token: "약한 라이브 단어만 있음",
  unit_expansion: "유닛 별칭으로 멤버 확장",
  group_expansion: "그룹 별칭으로 전 재적 멤버 확장",
  no_member_detected: "멤버 미감지",
  post_graduation_upload: "졸업 후 업로드",
  category_conflict: "분류 충돌(오리지널·커버 동시)",
  unknown_channel: "업로드 채널 미확인",
};
export const STATUS_LABELS = { deleted: "삭제됨", private: "비공개", unverified: "미검증", active: "정상" };
