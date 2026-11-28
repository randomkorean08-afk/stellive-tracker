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
/** ISO/UTC timestamp -> "YYYY-MM-DD HH:mm (KST)". Korea has no DST, so a fixed UTC+9 offset is exact. */
export function formatKst(iso) {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return "-";
  const k = new Date(t + 9 * 3600e3);
  const p = (n) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())} (KST)`;
}
export const fmt1 = (x) => (x === null || x === undefined || Number.isNaN(x) ? "-" : (Math.round(x * 10) / 10).toFixed(1));
export const DISCLAIMER = "모든 점수는 Gemini AI 분석 기반 평가이며 공식 평가가 아닙니다.";

export const REASON_LABELS = {
  stream_song_weak: "방송노래 후보 (약한 키워드: 노래·부른 등)",
  playlist_official_candidate: "재생목록 영상이 공식 곡(MV·OST)일 수 있음",
  playlist_full_stream_candidate: "재생목록 영상이 방송 풀버전(VOD)일 수 있음",
  weak_live_token: "약한 라이브 단어만 있음",
  unit_expansion: "유닛 별칭으로 멤버 확장",
  group_expansion: "그룹 별칭으로 전 재적 멤버 확장",
  no_member_detected: "멤버 미감지",
  post_graduation_upload: "졸업 후 업로드",
  category_conflict: "분류 충돌(오리지널·커버 동시)",
  unknown_channel: "업로드 채널 미확인",
};
export const STATUS_LABELS = { deleted: "삭제됨", private: "비공개", unverified: "미검증", active: "정상" };
