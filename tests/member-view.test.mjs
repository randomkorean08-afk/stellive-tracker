// 멤버별 보기: only the member's own songs; group songs only for members in that song's members array.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveAll } from "../lib/derive.mjs";
import { filterSongs, memberSongSummary } from "../lib/song-search.mjs";
import { fingerprintRepo } from "../lib/draft-guard.mjs";
import { readJson } from "./load.mjs";

const repo = {
  channels: readJson("data/channels-lock.json"), videos: readJson("data/videos.json"), overrides: readJson("data/overrides.json"),
  ratings: readJson("data/ratings.json"), baseline: readJson("data/baseline/baseline-2026-11-17.json"),
};
const d = deriveAll(repo);
const GEN4 = ["tokino-meri", "shizuki-toa", "hanayo-hiyori", "kogane-rang"];
const memberKeys = repo.channels.channels.filter((c) => c.type === "member").map((c) => c.key);
const ids = (m) => filterSongs(d.videoRows, { member: m }).map((r) => r.videoId);

test("4기 group song appears only for the four 4기 members", () => {
  for (const id of ["Ei7yWYi7x_E", "EKEts5IShas"]) {
    for (const m of memberKeys) assert.equal(ids(m).includes(id), GEN4.includes(m), `${id} for ${m}`);
  }
});

test("STAR TRAIL (9 members) is not shown for Huya, Kanna or the 4기", () => {
  const members = d.videoRows.find((r) => r.videoId === "v094-E3Pmtk").members;
  for (const m of memberKeys) assert.equal(ids(m).includes("v094-E3Pmtk"), members.includes(m), m);
  for (const m of ["sakihane-fuya", "airi-kanna", ...GEN4]) assert.ok(!ids(m).includes("v094-E3Pmtk"), m);
});

test("every song in a member view lists that member; summary adds up", () => {
  for (const m of memberKeys) {
    const rows = filterSongs(d.videoRows, { member: m });
    assert.ok(rows.every((r) => r.members.includes(m) && (r.listed ?? r.counted)), m);
    const s = memberSongSummary(rows);
    assert.equal(s.soloDuet + s.group + s.stream, s.total, m);
  }
  const mary = memberSongSummary(filterSongs(d.videoRows, { member: "tokino-meri" }));
  assert.ok(mary.soloDuet >= 1 && mary.group >= 2, JSON.stringify(mary));
});

// --- render the real member view with a small fake DOM ---
class FakeNode {}
class FakeText extends FakeNode { constructor(t) { super(); this.text = String(t); } get textContent() { return this.text; } }
class FakeEl extends FakeNode {
  constructor(tag) {
    super(); this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.namespaceURI = "http://www.w3.org/1999/xhtml";
    const cls = new Set(); this.classList = { add: (c) => cls.add(c), remove: (c) => cls.delete(c), toggle: (c, on) => ((on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) };
  }
  append(...xs) { for (const x of xs) this.children.push(x instanceof FakeNode ? x : new FakeText(x)); }
  get firstChild() { return this.children[0] ?? null; }
  removeChild(c) { this.children.splice(this.children.indexOf(c), 1); }
  setAttribute(k, v) { this.attrs[k] = v; if (k.startsWith("data-")) this.dataset[k.slice(5)] = v; }
  addEventListener() {}
  scrollIntoView() {}
  set textContent(t) { this.children = [new FakeText(t)]; }
  get textContent() { return this.children.map((c) => c.textContent).join(""); }
}
const all = (el, pred, out = []) => { if (pred(el)) out.push(el); for (const c of el.children ?? []) all(c, pred, out); return out; };

test("rendered member view: Mary's window shows the 4기 group songs, Lize's does not", async () => {
  globalThis.Node = FakeNode;
  globalThis.document = { createElement: (t) => new FakeEl(t), createElementNS: (_n, t) => new FakeEl(t), createTextNode: (t) => new FakeText(t) };
  const { state } = await import("../app/store.js");
  const { renderMembers, selectMember } = await import("../app/members.js");
  state.repo = { ...repo, fingerprint: fingerprintRepo(repo.ratings, repo.overrides) };
  const cardsFor = (m) => {
    selectMember(m);
    const root = new FakeEl("div");
    renderMembers(root);
    assert.ok(!root.textContent.includes("[object"));
    return all(root, (e) => e instanceof FakeEl && String(e.attrs.class ?? "").split(" ").includes("gcard")).map((e) => e.dataset.id);
  };
  const mary = cardsFor("tokino-meri");
  assert.ok(mary.includes("Ei7yWYi7x_E") && mary.includes("EKEts5IShas") && mary.includes("rKQptWhAvO0"));
  const lize = cardsFor("akane-lize");
  assert.ok(!lize.includes("Ei7yWYi7x_E") && !lize.includes("EKEts5IShas"));
  assert.ok(lize.includes("v094-E3Pmtk"), "STAR TRAIL is in Lize's window");
});
