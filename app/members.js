// 멤버별 보기: pick a member -> only the songs that member actually sings in.
// Group songs (단체곡) appear only for members listed in that song's members array.
import { h, clear, fmt1, add } from "./dom.js";
import { derived, state } from "./store.js";
import { filterSongs, memberSongSummary } from "../lib/song-search.mjs";
import { collapseDuplicateClips } from "../lib/clip-dedupe.mjs";
import { renderSongBrowser, newBrowserState, memberName } from "./gallery.js";

let current = null;
const states = new Map(); // member -> browser state (kept while switching)

export function selectMember(key) { current = key; }

export function renderMembers(root) {
  clear(root);
  const d = derived();
  const lock = state.repo?.channels ?? {};
  const members = (lock.channels ?? []).filter((c) => c.type === "member");
  current ??= members[0]?.key ?? null;

  const picker = h("section", { class: "card member-picker" },
    (lock.units ?? []).map((u) => {
      const inUnit = members.filter((m) => m.unit === u.key);
      if (!inUnit.length) return null;
      return h("div", { class: "unit-row" },
        h("span", { class: "unit-label small muted" }, u.label),
        inUnit.map((m) => h("button", { type: "button", class: `member-btn${m.key === current ? " on" : ""}`, "aria-pressed": String(m.key === current),
          onclick: () => { current = m.key; renderMembers(root); } }, m.displayName)));
    }));
  add(root, picker);
  if (!current) return;

  const card = d.memberCards.find((c) => c.key === current);
  const views = {};
  for (const [id, v] of Object.entries(state.repo?.videos?.videos ?? {})) if (typeof v.viewCount === "number") views[id] = v.viewCount;
  const aliasesOf = (k) => { const c = members.find((x) => x.key === k); return c ? [c.displayName, ...(c.aliases ?? [])] : []; };
  const mine = collapseDuplicateClips(filterSongs(d.videoRows, { member: current }), { views, aliasesOf }).rows;
  const s = memberSongSummary(mine);

  add(root, h("section", { class: "card member-summary" },
    h("h3", {}, memberName(current), card?.grade ? h("span", { class: "tag" }, ` 루브릭 ${fmt1(card.rubricTotal)} · ${card.grade}`) : null),
    h("div", { class: "summary" },
      h("div", { class: "stat" }, h("b", {}, String(s.total)), h("span", {}, "참여곡")),
      h("div", { class: "stat" }, h("b", {}, String(s.soloDuet)), h("span", {}, "솔로·듀엣")),
      h("div", { class: "stat" }, h("b", {}, String(s.group)), h("span", {}, "단체곡")),
      h("div", { class: "stat" }, h("b", {}, String(s.stream)), h("span", {}, "방송노래")),
      h("div", { class: "stat" }, h("b", {}, card?.songAvg != null ? fmt1(card.songAvg) : "-"),
        h("span", {}, `평균 기준 점수 (${card?.songAvgN ?? 0}곡, 단체곡·방송노래 제외)`))),
  ));

  if (!states.has(current)) states.set(current, newBrowserState(current));
  renderSongBrowser(root, states.get(current), { fixedMember: current,
    note: "이 멤버가 실제로 참여한 곡만 표시합니다. 단체곡은 참여 멤버 명단에 있는 멤버의 창에만 나타납니다." });
}
