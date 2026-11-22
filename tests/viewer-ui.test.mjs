// UI overhaul: song-only preview viewer, no manual scoring UI, curator tools behind ?admin=1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { ROOT, readJson } from "./load.mjs";
import { fingerprintRepo } from "../lib/draft-guard.mjs";

const appDir = path.join(ROOT, "app");
const src = (f) => readFileSync(path.join(appDir, f), "utf8");

test("no manual scoring UI: scoring view removed, no range sliders anywhere in app/", () => {
  assert.ok(!existsSync(path.join(appDir, "scoring.js")));
  for (const f of readdirSync(appDir).filter((x) => x.endsWith(".js"))) assert.ok(!/type:\s*"range"/.test(src(f)), f);
  const main = src("main.js");
  assert.ok(!/"scoring"/.test(main) && !/"채점"/.test(main));
});

test("public tabs are dashboard + gallery; curator tabs only with ?admin", () => {
  const main = src("main.js");
  assert.match(main, /\["gallery", "노래 갤러리"\]/);
  assert.match(main, /ADMIN \? \[\["review"/);
});

test("song search and gallery never offer a 'show hidden' toggle", () => {
  for (const f of ["gallery.js", "song-search.js"]) assert.ok(!/includeHidden:\s*true|검토 대기·제외 포함/.test(src(f)), f);
});

// --- render the real gallery with a small fake DOM and real data ---
class FakeNode {}
class FakeText extends FakeNode { constructor(t) { super(); this.text = String(t); this.parent = null; } get textContent() { return this.text; } }
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

test("gallery renders only listed song videos (counted music + 방송노래), with a preview and no stringified nodes", async () => {
  globalThis.Node = FakeNode;
  globalThis.document = { createElement: (t) => new FakeEl(t), createElementNS: (_n, t) => new FakeEl(t), createTextNode: (t) => new FakeText(t) };
  const { state } = await import("../app/store.js");
  const { renderGallery } = await import("../app/gallery.js");
  const { deriveAll } = await import("../lib/derive.mjs");
  const repo = {
    channels: readJson("data/channels-lock.json"), videos: readJson("data/videos.json"), overrides: readJson("data/overrides.json"),
    ratings: readJson("data/ratings.json"), baseline: readJson("data/baseline/baseline-2026-11-17.json"),
  };
  state.repo = { ...repo, fingerprint: fingerprintRepo(repo.ratings, repo.overrides) };
  const d = deriveAll(repo);
  const music = new Set(d.videoRows.filter((r) => r.listed).map((r) => r.videoId));

  const root = new FakeEl("div");
  renderGallery(root);
  const cards = all(root, (e) => e instanceof FakeEl && String(e.attrs.class ?? "").split(" ").includes("gcard"));
  assert.equal(cards.length, music.size, "one card per listed song video");
  for (const c of cards) assert.ok(music.has(c.dataset.id), `non-music card ${c.dataset.id}`);
  const shorts = Object.values(repo.videos.videos).filter((v) => v.isShort === true).map((v) => v.videoId);
  assert.ok(shorts.every((id) => !cards.some((c) => c.dataset.id === id)), "no Shorts in gallery");
  assert.ok(all(root, (e) => e instanceof FakeEl && e.attrs.class === "card preview").length === 1, "preview panel present");
  assert.ok(!root.textContent.includes("[object") && !/\bnull\b/.test(root.textContent));
  assert.ok(all(root, (e) => e instanceof FakeEl && e.tag === "input" && e.attrs.type === "range").length === 0, "no sliders");
});
