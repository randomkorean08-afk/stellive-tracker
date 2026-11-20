import { h, clear, fmt1 } from "./dom.js";
import {
  derived, state, getVideoRating, setSongScore, setMemberItem, clearMemberVideo, setRubricItem, mergedRatings,
} from "./store.js";
import { VIDEO_ITEMS, RUBRIC_ITEMS, memberVideoScore, MIN_RATED } from "../lib/derive.mjs";
import { memberName } from "./archive.js";
import { RUBRIC_HINTS } from "./rubric-hints.js";

let selectedId = null;
let listQuery = "";
let rubricMember = null;
let embedOn = false;

export function selectVideo(id) { selectedId = id; embedOn = false; }

/**
 * Slider + number + clear. Empty (null) state: grey handle, blank number. No default value is ever stored.
 * onChange(value|null) is called on every user edit.
 */
const r1 = (v) => Math.round(v * 10) / 10;
function sliderField({ label, min = 0, max, step, value, title, onChange }) {
  const range = h("input", { type: "range", min, max, step, value: value ?? min, "aria-label": label, class: value === null ? "empty" : "" });
  const num = h("input", { type: "number", min, max, step: 0.1, value: value === null ? "" : value, "aria-label": `${label} 숫자 입력`, placeholder: "-" });
  const set = (v) => {
    if (v === null) {
      range.classList.add("empty");
      range.value = min;
      num.value = "";
    } else {
      range.classList.remove("empty");
      range.value = v;
      num.value = v;
    }
    onChange(v);
  };
  range.addEventListener("input", () => set(r1(Number(range.value))));
  num.addEventListener("input", () => {
    if (num.value === "") return set(null);
    const v = r1(Math.max(min, Math.min(max, Number(num.value))));
    if (Number.isFinite(v)) { range.classList.remove("empty"); range.value = v; onChange(v); }
  });
  const clearBtn = h("button", { type: "button", class: "small-btn", onclick: () => set(null) }, "비우기");
  return h("div", { class: "slider-field", title }, h("span", { class: "slider-label" }, label), range, num, clearBtn);
}

function memberSection(id, m) {
  const summary = h("span", {});
  const warn = h("p", { class: "warn-text", hidden: true }, "5개 모두 입력해야 멤버 점수에 반영됩니다");
  const hint = h("p", { class: "muted small" }, "세부 5항목은 선택 입력입니다. 5개를 모두 입력한 경우에만 멤버 점수에 반영되고, 비워두면 곡 총점이 사용됩니다.");
  const refresh = () => {
    const items = getVideoRating(id)?.members?.[m] ?? {};
    const filled = VIDEO_ITEMS.filter((i) => items[i.key] != null).length;
    const sc = memberVideoScore(m, id, mergedRatings());
    summary.textContent = `${memberName(m)} — ${sc !== null ? `영상 점수 ${fmt1(sc)}` : filled ? `부분 입력 ${filled}/5 (미반영)` : "미채점"}`;
    warn.hidden = !(filled > 0 && filled < 5);
  };
  const cur = getVideoRating(id)?.members?.[m] ?? {};
  const fields = VIDEO_ITEMS.map((it) =>
    sliderField({ label: it.label, max: 100, step: 0.1, value: cur[it.key] ?? null, onChange: (v) => { setMemberItem(id, m, it.key, v); refresh(); } }));
  const det = h("details", { class: "member-sec", open: Object.keys(cur).length > 0 }, h("summary", {}, summary), hint, warn, fields,
    h("button", { type: "button", class: "small-btn", onclick: () => { clearMemberVideo(id, m); renderScoringInto(); } }, "이 멤버 5항목 모두 비우기"));
  refresh();
  return det;
}

let rootEl = null;
function renderScoringInto() { if (rootEl) renderScoring(rootEl); }

function videoEditor(id) {
  const d = derived();
  const row = d.videoRows.find((r) => r.videoId === id);
  if (!row) return h("p", { class: "muted" }, "영상을 찾을 수 없습니다.");
  const rating = getVideoRating(id);
  const embedBox = h("div", { class: "embed" });
  const toggle = h("button", { type: "button", onclick: () => {
    embedOn = !embedOn;
    clear(embedBox);
    if (embedOn) embedBox.append(h("iframe", { src: `https://www.youtube-nocookie.com/embed/${id}`, title: "YouTube 미리보기", loading: "lazy", allowfullscreen: true }));
    toggle.textContent = embedOn ? "미리보기 닫기" : "YouTube 미리보기 열기";
  } }, "YouTube 미리보기 열기");
  const scoreLine = h("span", { class: "muted small" });
  const upd = () => {
    const s = getVideoRating(id)?.songScore ?? null;
    scoreLine.textContent = s === null ? "상태: 미채점 (평균·순위에 영향 없음)" : `상태: 영상 점수 ${fmt1(s)}`;
  };
  const songField = sliderField({ label: "영상 점수 (songScore)", max: 100, step: 0.1, value: rating?.songScore ?? null, onChange: (v) => { setSongScore(id, v); upd(); } });
  const revert = h("button", { type: "button", class: "small-btn", onclick: () => { setSongScore(id, null); renderScoringInto(); } }, "미채점으로 되돌리기");
  upd();
  return h("div", { class: "editor" },
    h("h3", {}, row.title),
    h("p", { class: "small muted" }, `${row.videoId} · ${row.publishedAt ?? "-"} · 멤버: ${row.members.map(memberName).join(", ") || "없음"}`),
    h("img", { class: "thumb big", alt: "", src: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` }),
    h("div", {}, toggle), embedBox,
    h("h4", {}, "영상 전체 인상 점수 ", h("span", { class: "tag" }, "개인 평가")),
    songField, h("div", {}, revert, " ", scoreLine),
    h("h4", {}, "참여 멤버별 5항목 (0–100)"),
    row.members.length ? row.members.map((m) => memberSection(id, m)) : h("p", { class: "muted" }, "참여 멤버가 없습니다. 검토 큐에서 멤버를 지정하세요."),
  );
}

function rubricEditor() {
  const members = state.repo.channels.channels.filter((c) => c.type === "member");
  rubricMember ??= members[0]?.key;
  const preview = h("p", { class: "rubric-preview" });
  const refreshPreview = () => {
    const card = derived().memberCards.find((c) => c.key === rubricMember);
    preview.textContent = card?.rubricTotal == null
      ? "10항목을 모두 입력하면 총점·등급이 계산됩니다."
      : `A 총점 ${fmt1(card.rubricTotal)} (물리 ${fmt1(card.physical)}/55 · 해석 ${fmt1(card.interpretive)}/45) · 등급 ${card.grade} (개인 평가)`;
  };
  const box = h("div", {});
  const build = () => {
    clear(box);
    const items = mergedRatings().memberRubric[rubricMember]?.items ?? {};
    box.append(RUBRIC_ITEMS.map((it) => {
      const hint = RUBRIC_HINTS[it.key];
      return h("div", { class: "rubric-item" },
        sliderField({ label: `${it.label} (만점 ${it.max})`, max: it.max, step: 0.1, value: items[it.key] ?? null, title: hint,
          onChange: (v) => { setRubricItem(rubricMember, it.key, v); refreshPreview(); } }),
        h("div", { class: "muted small" }, hint));
    }));
    refreshPreview();
  };
  const sel = h("select", { onchange: (e) => { rubricMember = e.target.value; build(); } },
    members.map((m) => h("option", { value: m.key, selected: m.key === rubricMember }, m.displayName)));
  build();
  return h("section", { class: "card" },
    h("h3", {}, "멤버 루브릭 (10항목) ", h("span", { class: "tag" }, "개인 평가")),
    h("label", { class: "inline" }, "멤버 ", sel), box, preview);
}

export function renderScoring(root) {
  rootEl = root;
  clear(root);
  const d = derived();
  const listBox = h("ul", { class: "pick-list" });
  const fill = () => {
    const q = listQuery.trim().toLowerCase();
    clear(listBox).append(d.videoRows.filter((r) => !q || r.title.toLowerCase().includes(q)).slice(0, 300).map((r) =>
      h("li", {}, h("button", { type: "button", class: `pick${r.videoId === selectedId ? " on" : ""}`, onclick: () => { selectVideo(r.videoId); renderScoring(root); } },
        r.title, h("span", { class: "muted small" }, ` ${r.videoId}`),
        r.songScore !== null ? h("span", { class: "badge" }, fmt1(r.songScore)) : h("span", { class: "badge unrated" }, "미채점")))));
  };
  fill();
  root.append(
    h("div", { class: "split" },
      h("section", { class: "card" },
        h("h3", {}, "영상 선택"),
        h("input", { type: "search", placeholder: "제목 검색", value: listQuery, oninput: (e) => { listQuery = e.target.value; fill(); } }),
        listBox),
      h("section", { class: "card" }, h("h3", {}, "영상 채점"), selectedId ? videoEditor(selectedId) : h("p", { class: "muted" }, "왼쪽에서 영상을 고르거나 영상 아카이브에서 클릭하세요. 슬라이더는 비어 있는 상태로 시작하며, 입력하기 전에는 미채점입니다.")),
    ),
    rubricEditor(),
    h("p", { class: "small muted" }, `B 순위는 채점 ${MIN_RATED}곡 이상인 멤버만 산정됩니다. 편집 내용은 브라우저 초안에 저장되며 내보내기 탭에서 JSON으로 내보냅니다.`),
  );
}
