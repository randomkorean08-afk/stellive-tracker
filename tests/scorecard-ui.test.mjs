import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ROOT, readJson } from "./load.mjs";
import { fingerprintRepo } from "../lib/draft-guard.mjs";

const appDir = path.join(ROOT, "app");

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

test("no rank-shortfall or missing-B placeholder strings anywhere in app/", () => {
  for (const f of readdirSync(appDir).filter((x) => x.endsWith(".js"))) {
    const src = readFileSync(path.join(appDir, f), "utf8");
    assert.ok(!src.includes("기준 미달"), `${f} still contains '기준 미달'`);
    assert.ok(!src.includes("B 없음"), `${f} still contains 'B 없음'`);
  }
});

test("scorecard dashboard: A mode renders all 15 without shortfall badge; B mode renders only ranked members in order", async () => {
  setupDom();
  const { state } = await import("../app/store.js");
  const { renderScorecard, setSortMode } = await import("../app/scorecard.js");
  const { deriveAll } = await import("../lib/derive.mjs");

  const repo = loadRealRepo();
  state.repo = { ...repo, fingerprint: fingerprintRepo(repo.ratings, repo.overrides) };
  const d = deriveAll(repo);

  const rankedB = d.memberCards.filter((c) => c.rankB !== null).sort((a, b) => a.rankB - b.rankB);
  const unrankedB = d.memberCards.filter((c) => c.rankB === null);
  assert.ok(rankedB.length > 0 && unrankedB.length > 0, "real data has both B-ranked and B-unranked members");

  const root = new FakeEl("div");
  setSortMode("A");
  renderScorecard(root);

  const cardsA = all(root, (e) => hasClass(e, "member-card"));
  assert.equal(cardsA.length, 15, "A mode renders all 15 members");
  assert.deepEqual(
    cardsA.map((c) => all(c, (e) => hasClass(e, "name"))[0].textContent),
    d.memberCards.map((c) => c.displayName),
  );
  assert.equal(all(root, (e) => hasClass(e, "badge") && hasClass(e, "warn")).length, 0, "no shortfall warn badge in scorecard");
  assert.ok(!root.textContent.includes("기준 미달"));
  assert.ok(!root.textContent.includes("B 없음"));
  assert.ok(!root.textContent.includes("[object") && !/\bnull\b/.test(root.textContent));

  // Unranked members still show their B average line without any B-rank badge
  for (const u of unrankedB) {
    const cardEl = cardsA.find((el) => all(el, (e) => hasClass(e, "name"))[0].textContent === u.displayName);
    const bLine = all(cardEl, (e) => hasClass(e, "b-line"))[0];
    assert.ok(bLine.textContent.startsWith("B. 곡 평균"), `B average line kept for ${u.displayName}`);
    assert.equal(all(bLine, (e) => hasClass(e, "badge")).length, 0, `no B-rank badge for ${u.displayName}`);
  }

  // A/B chart draws B bars only for members with songAvg !== null
  const barBs = all(root, (e) => hasClass(e, "bar-b"));
  assert.equal(barBs.length, d.memberCards.filter((c) => c.songAvg !== null).length);

  // Switch to B sort mode via the select control
  const sortSelect = all(root, (e) => e instanceof FakeEl && e.tag === "select" && all(e, (o) => o instanceof FakeEl && (o.value ?? o.attrs.value) === "B").length > 0)[0];
  assert.ok(sortSelect, "sort select rendered");
  sortSelect.listeners.change[0]({ target: { value: "B" } });

  const cardsB = all(root, (e) => hasClass(e, "member-card"));
  assert.equal(cardsB.length, rankedB.length, "B mode renders ONLY ranked members");
  assert.deepEqual(
    cardsB.map((c) => all(c, (e) => hasClass(e, "name"))[0].textContent),
    rankedB.map((c) => c.displayName),
    "B mode cards are in rankB order",
  );
  for (let i = 0; i < cardsB.length; i++) {
    const bLine = all(cardsB[i], (e) => hasClass(e, "b-line"))[0];
    assert.ok(bLine.textContent.includes(`B 순위 #${rankedB[i].rankB}`));
  }
  for (const u of unrankedB) {
    assert.ok(!cardsB.some((el) => all(el, (e) => hasClass(e, "name"))[0].textContent === u.displayName), `${u.displayName} omitted in B mode`);
  }

  // Charts remain intact with all 15 members in B mode
  assert.equal(all(root, (e) => hasClass(e, "bar-a")).length, d.memberCards.filter((c) => c.rubricTotal !== null).length);

  setSortMode("A");
});

test("members view still lists every member regardless of rankB", async () => {
  setupDom();
  const { state } = await import("../app/store.js");
  const { renderMembers } = await import("../app/members.js");

  const repo = loadRealRepo();
  state.repo = { ...repo, fingerprint: fingerprintRepo(repo.ratings, repo.overrides) };
  const expectedMembers = repo.channels.channels.filter((c) => c.type === "member");

  const root = new FakeEl("div");
  renderMembers(root);

  const buttons = all(root, (e) => hasClass(e, "member-btn"));
  assert.equal(buttons.length, expectedMembers.length);
  assert.deepEqual(
    buttons.map((b) => b.textContent).sort(),
    expectedMembers.map((m) => m.displayName).sort(),
  );
});
