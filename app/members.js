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

function groupUnitsByGeneration(units, members) {
  const groups = [];
  const gen1Units = units.filter((u) => u.key.startsWith("gen1-"));
  const gen1Members = members.filter((m) => gen1Units.some((u) => u.key === m.unit));
  if (gen1Members.length) groups.push({ key: "gen1", label: "1기 Mystic/Everys", members: gen1Members });
  for (const u of units) {
    if (u.key.startsWith("gen1-")) continue;
    const inUnit = members.filter((m) => m.unit === u.key);
    if (inUnit.length) groups.push({ key: u.key, label: u.label, members: inUnit });
  }
  return groups;
}

export function renderMembers(root) {
  clear(root);
  const d = derived();
  const lock = state.repo?.channels ?? {};
  const units = lock.units ?? [];
  const unitLabel = new Map(units.map((u) => [u.key, u.label]));
  const members = (lock.channels ?? []).filter((c) => c.type === "member");
  current ??= members[0]?.key ?? null;

  const views = {};
  for (const [id, v] of Object.entries(state.repo?.videos?.videos ?? {})) if (typeof v.viewCount === "number") views[id] = v.viewCount;
  const aliasesOf = (k) => { const c = members.find((x) => x.key === k); return c ? [c.displayName, ...(c.aliases ?? [])] : []; };
  const statsByMember = new Map(members.map((m) => {
    const allListed = filterSongs(d.videoRows, { member: m.key });
    const rows = collapseDuplicateClips(allListed, { views, aliasesOf }).rows;
    return [m.key, { songs: rows.length, videos: allListed.length, rows }];
  }));

  const genGroups = groupUnitsByGeneration(units, members);
  const picker = h("section", { class: "member-picker" },
    genGroups.map((g) => h("div", { class: "gen-group" },
      h("h3", { class: "gen-heading" }, g.label),
      h("div", { class: "gen-cards" }, g.members.map((m) => {
        const isSelected = m.key === current;
        const st = statsByMember.get(m.key);
        const initial = (m.displayName || "?").trim().charAt(0);
        return h("div", {
          class: `member-profile-card${isSelected ? " on" : ""}`,
          style: `--accent: var(--c-${m.key})`,
        },
          h("span", { class: "member-avatar", "aria-hidden": "true" }, initial),
          h("div", { class: "member-profile-info" },
            h("div", { class: "member-name-row" },
              h("button", {
                type: "button",
                class: `member-btn${isSelected ? " on" : ""}`,
                "aria-pressed": String(isSelected),
                onclick: () => { current = m.key; renderMembers(root); },
              }, m.displayName),
              m.status === "graduated" ? h("span", { class: "badge grad" }, "졸업") : null,
            ),
            h("span", { class: "member-unit" }, unitLabel.get(m.unit) ?? m.unit ?? ""),
            h("span", { class: "member-counts tiny muted" }, `참여곡 ${st.songs} | 영상 ${st.videos}`),
          ),
        );
      })),
    )),
  );
  add(root, picker);
  if (!current) return;

  const card = d.memberCards.find((c) => c.key === current);
  const mine = statsByMember.get(current)?.rows ?? [];
  const s = memberSongSummary(mine);
  const curMember = members.find((m) => m.key === current);
  const curName = memberName(current);
  const curInitial = curName.trim().charAt(0);

  add(root, h("section", { class: "card member-summary", style: `--accent: var(--c-${current})` },
    h("div", { class: "member-summary-head" },
      h("span", { class: "member-avatar lg", "aria-hidden": "true" }, curInitial),
      h("div", { class: "member-summary-meta" },
        h("h3", {}, curName,
          curMember?.unit ? h("span", { class: "tag" }, unitLabel.get(curMember.unit) ?? curMember.unit) : null,
          card?.grade ? h("span", { class: "tag accent-tag" }, `루브릭 ${fmt1(card.rubricTotal)} · ${card.grade}`) : null),
      ),
    ),
    h("div", { class: "summary summary-5" },
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
