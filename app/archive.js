import { h, clear, fmt1, STATUS_LABELS, REASON_LABELS, add } from "./dom.js";
import { formatViews } from "../lib/song-search.mjs";
import { derived, state } from "./store.js";
import { CATEGORIES } from "../lib/derive.mjs";

const f = { member: "", category: "", rated: "", status: "", review: "", q: "" };
const catLabel = (k) => CATEGORIES.find((c) => c.key === k)?.label ?? k;

export function memberName(key) {
  return state.repo.channels.channels.find((c) => c.key === key)?.displayName ?? key;
}

export function renderArchive(root, openScoring) {
  clear(root);
  const d = derived();
  const sel = (name, opts) =>
    h("select", { onchange: (e) => { f[name] = e.target.value; renderArchive(root, openScoring); } },
      opts.map(([v, l]) => h("option", { value: v, selected: f[name] === v }, l)));
  const members = state.repo.channels.channels.filter((c) => c.type === "member");
  add(root, 
    h("div", { class: "filters" },
      h("label", {}, "멤버 ", sel("member", [["", "전체"], ...members.map((m) => [m.key, m.displayName])])),
      h("label", {}, "카테고리 ", sel("category", [["", "전체"], ...CATEGORIES.map((c) => [c.key, c.label])])),
      h("label", {}, "채점 ", sel("rated", [["", "전체"], ["rated", "채점됨"], ["unrated", "미채점"]])),
      h("label", {}, "상태 ", sel("status", [["", "전체"], ["active", "정상"], ["deleted", "삭제됨"], ["private", "비공개"], ["unverified", "미검증"]])),
      h("label", {}, "검토 ", sel("review", [["", "전체"], ["yes", "검토 필요"]])),
      h("label", {}, "제목 검색 ",
        h("input", { type: "search", value: f.q, oninput: (e) => { f.q = e.target.value; list(); } }))),
  );
  const out = h("div", { class: "table-wrap" });
  add(root, out);

  function list() {
    const q = f.q.trim().toLowerCase();
    const rows = d.videoRows.filter((r) => {
      if (f.member && !r.members.includes(f.member)) return false;
      if (f.category && r.category !== f.category) return false;
      const rated = r.songScore !== null || Object.values(r.memberScores).some((v) => v !== null);
      if (f.rated === "rated" && !rated) return false;
      if (f.rated === "unrated" && rated) return false;
      if (f.status && r.status !== f.status) return false;
      if (f.review === "yes" && !r.needsReview) return false;
      if (q && !r.title.toLowerCase().includes(q)) return false;
      return true;
    });
    add(clear(out), 
      h("p", { class: "muted small" }, `${rows.length}건 표시 (ID 기준, 같은 곡명이라도 영상이 다르면 별개 항목)`),
      h("div", { class: "vlist" }, rows.map((r) => {
        const rated = r.songScore !== null || Object.values(r.memberScores).some((v) => v !== null);
        const faded = r.status === "deleted" || r.status === "private";
        return h("div", { class: `vrow${faded ? " faded" : ""}`, tabindex: "0", role: "button", "data-id": r.videoId,
          onclick: () => openScoring(r.videoId),
          onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openScoring(r.videoId); } } },
          h("img", { class: "thumb", loading: "lazy", alt: "", src: `https://i.ytimg.com/vi/${r.videoId}/mqdefault.jpg` }),
          h("div", { class: "vinfo" },
            h("div", { class: "vtitle" }, r.title),
            h("div", { class: "chips" }, r.members.map((m) => h("span", { class: "chip" }, memberName(m))), r.members.length ? null : h("span", { class: "chip warn" }, "멤버 없음")),
            h("div", { class: "small muted" }, `${catLabel(r.category)} · ${r.publishedAt ?? "-"}${formatViews(state.repo.videos.videos[r.videoId]?.viewCount) ? ` · 조회수 ${formatViews(state.repo.videos.videos[r.videoId].viewCount)}` : ""} · ${r.videoId}`),
            h("div", { class: "badges" },
              r.songScore !== null ? h("span", { class: "badge" }, `점수 ${fmt1(r.songScore)}`) : h("span", { class: "badge unrated" }, "미채점"),
              Object.entries(r.memberScores).filter(([, v]) => v !== null).map(([m, v]) => h("span", { class: "badge" }, `${memberName(m)} ${fmt1(v)}`)),
              r.status !== "active" ? h("span", { class: `badge st-${r.status}` }, STATUS_LABELS[r.status] ?? r.status) : null,
              r.needsReview ? h("span", { class: "badge warn", title: r.reviewReasons.map((x) => REASON_LABELS[x] ?? x).join(", ") }, "검토 필요") : null,
              r.excluded ? h("span", { class: "badge" }, "제외") : null,
              !r.counted && !r.excluded && !r.needsReview ? h("span", { class: "badge" }, "집계 제외 분류") : null,
              rated ? null : null)));
      })));
  }
  list();
}
