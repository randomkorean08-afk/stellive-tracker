import { test } from "node:test";
import assert from "node:assert/strict";
import { readJson } from "./load.mjs";
import { fingerprintRepo } from "../lib/draft-guard.mjs";
import { deriveAll } from "../lib/derive.mjs";

class FakeNode {}
class FakeText extends FakeNode {
  constructor(t) { super(); this.text = String(t); }
  get textContent() { return this.text; }
}
class FakeEl extends FakeNode {
  constructor(tag, ns = "http://www.w3.org/1999/xhtml") {
    super();
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.listeners = {};
    this.namespaceURI = ns;
    const cls = new Set();
    this.classList = {
      add: (c) => cls.add(c),
      remove: (c) => cls.delete(c),
      toggle: (c, on) => ((on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c)),
      contains: (c) => cls.has(c),
    };
  }
  append(...xs) { for (const x of xs) this.children.push(x instanceof FakeNode ? x : new FakeText(x)); }
  get firstChild() { return this.children[0] ?? null; }
  removeChild(c) { this.children.splice(this.children.indexOf(c), 1); }
  setAttribute(k, v) { this.attrs[k] = v; if (k.startsWith("data-")) this.dataset[k.slice(5)] = v; }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  click() { for (const fn of this.listeners.click ?? []) fn({ currentTarget: this, target: this }); }
  set textContent(t) { this.children = [new FakeText(t)]; }
  get textContent() { return this.children.map((c) => c.textContent).join(""); }
}

const all = (el, pred, out = []) => {
  if (pred(el)) out.push(el);
  for (const c of el.children ?? []) all(c, pred, out);
  return out;
};
const hasClass = (el, cls) => el instanceof FakeEl && String(el.attrs.class ?? "").split(/\s+/).includes(cls);

function setupDom() {
  globalThis.Node = FakeNode;
  globalThis.document = {
    createElement: (t) => new FakeEl(t),
    createElementNS: (ns, t) => new FakeEl(t, ns),
    createTextNode: (t) => new FakeText(t),
  };
}

function loadRealRepo() {
  return {
    channels: readJson("data/channels-lock.json"),
    videos: readJson("data/videos.json"),
    overrides: readJson("data/overrides.json"),
    ratings: readJson("data/ratings.json"),
    baseline: readJson("data/baseline/baseline-2026-11-17.json"),
  };
}

test("clicking a scorecard member card invokes openMember with that member's key in both A and B sort modes", async () => {
  setupDom();
  const { state } = await import("../app/store.js");
  const { renderScorecard, setSortMode } = await import("../app/scorecard.js");

  const repo = loadRealRepo();
  state.repo = { ...repo, fingerprint: fingerprintRepo(repo.ratings, repo.overrides) };
  const d = deriveAll(repo);

  const opened = [];
  const root = new FakeEl("div");
  setSortMode("A");
  renderScorecard(root, { openMember: (key) => opened.push(key) });

  const cardsA = all(root, (e) => hasClass(e, "member-card"));
  assert.equal(cardsA.length, d.memberCards.length);

  for (let i = 0; i < cardsA.length; i++) {
    const btn = all(cardsA[i], (e) => e instanceof FakeEl && e.tag === "button")[0];
    assert.ok(btn, `member card ${d.memberCards[i].key} has a button`);
    assert.equal(btn.attrs.type, "button");
    assert.equal(btn.attrs["aria-label"], `${d.memberCards[i].displayName} 노래 모음 보기`);
    btn.click();
  }
  assert.deepEqual(opened, d.memberCards.map((c) => c.key));

  // Switching to B sort mode preserves openMember across re-renders
  opened.length = 0;
  const rankedB = d.memberCards.filter((c) => c.rankB !== null).sort((a, b) => a.rankB - b.rankB);
  const sortSelect = all(root, (e) => e instanceof FakeEl && e.tag === "select" && all(e, (o) => o instanceof FakeEl && (o.value ?? o.attrs.value) === "B").length > 0)[0];
  sortSelect.listeners.change[0]({ target: { value: "B" } });

  const cardsB = all(root, (e) => hasClass(e, "member-card"));
  assert.equal(cardsB.length, rankedB.length);
  const firstBtnB = all(cardsB[0], (e) => e instanceof FakeEl && e.tag === "button")[0];
  firstBtnB.click();
  assert.deepEqual(opened, [rankedB[0].key]);

  setSortMode("A");
});

test("renderScorecard works without options and selectMember + renderMembers displays the chosen member", async () => {
  setupDom();
  const { state } = await import("../app/store.js");
  const { renderScorecard, setSortMode } = await import("../app/scorecard.js");
  const { renderMembers, selectMember } = await import("../app/members.js");

  const repo = loadRealRepo();
  state.repo = { ...repo, fingerprint: fingerprintRepo(repo.ratings, repo.overrides) };

  const scoreRoot = new FakeEl("div");
  setSortMode("A");
  renderScorecard(scoreRoot);
  const firstBtn = all(scoreRoot, (e) => hasClass(e, "member-card-btn"))[0];
  assert.doesNotThrow(() => firstBtn.click());

  selectMember("akane-lize");
  const memberRoot = new FakeEl("div");
  renderMembers(memberRoot);
  const selectedBtn = all(memberRoot, (e) => hasClass(e, "member-btn") && e.attrs["aria-pressed"] === "true");
  assert.equal(selectedBtn.length, 1);
  assert.equal(selectedBtn[0].textContent, "아카네 리제");
  const summary = all(memberRoot, (e) => hasClass(e, "member-summary"))[0];
  assert.ok(summary.textContent.includes("아카네 리제"));
});
