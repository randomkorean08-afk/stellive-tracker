// Regression: arrays of DOM nodes / null must never be stringified into the page
// ("[object HTMLLIElement],…" in 영상 선택, "[object HTMLDivElement],…" in 멤버 루브릭, "null" in 내보내기).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./load.mjs";

// --- minimal fake DOM (enough for app/dom.js); native append semantics: non-Node args become text ---
class FakeNode {}
class FakeText extends FakeNode { constructor(t) { super(); this.text = String(t); } get textContent() { return this.text; } }
class FakeEl extends FakeNode {
  constructor(tag) { super(); this.tag = tag; this.children = []; this.attrs = {}; this.namespaceURI = "http://www.w3.org/1999/xhtml"; }
  append(...xs) { for (const x of xs) this.children.push(x instanceof FakeNode ? x : new FakeText(x)); } // like the browser: String(array) -> "[object …]"
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener() {}
  get textContent() { return this.children.map((c) => c.textContent).join(""); }
}
globalThis.Node = FakeNode;
globalThis.document = { createElement: (t) => new FakeEl(t), createElementNS: (_ns, t) => new FakeEl(t), createTextNode: (t) => new FakeText(t) };
const { h, add } = await import("../app/dom.js");

const texts = (el) => el.children.filter((c) => c instanceof FakeText).map((c) => c.text);

test("add(): arrays of nodes are flattened into child elements (no '[object …]' text)", () => {
  const box = h("div", {});
  add(box, [h("li", {}, "a"), h("li", {}, "b")], [[h("li", {}, "c")]]);
  assert.equal(box.children.length, 3);
  assert.ok(box.children.every((c) => c instanceof FakeEl && c.tag === "li"));
  assert.ok(!box.textContent.includes("[object"));
});

test("add(): null / undefined / false are skipped (no 'null' text)", () => {
  const box = h("div", {});
  add(box, null, undefined, false, h("p", {}, "ok"), null);
  assert.equal(box.children.length, 1);
  assert.deepEqual(texts(box), []);
  assert.equal(box.textContent, "ok");
});

test("add(): returns the element (chainable with clear())", () => {
  const box = h("div", {});
  assert.equal(add(box, "x"), box);
});

test("the fake DOM reproduces the original bug with native append (sanity check)", () => {
  const box = h("div", {});
  box.append([h("li", {}), h("li", {})]);
  assert.match(box.textContent, /\[object/); // proves the test above would catch a regression
});

// --- static guard over app/: no native append (except SVG building in charts.js) and no innerHTML ---
const appDir = path.join(ROOT, "app");
const appFiles = readdirSync(appDir).filter((f) => f.endsWith(".js"));

test("app/: HTML is appended only via add()/h() — no native .append( outside dom.js/charts.js", () => {
  for (const f of appFiles) {
    if (f === "dom.js" || f === "charts.js") continue;
    const src = readFileSync(path.join(appDir, f), "utf8");
    assert.ok(!/\.append\(/.test(src), `${f}: use add(el, ...) instead of el.append(...)`);
  }
});

test("app/charts.js: native .append( only receives single SVG/HTML nodes, never a .map() result", () => {
  const src = readFileSync(path.join(appDir, "charts.js"), "utf8");
  for (const m of src.matchAll(/\.append\((\w+)\(/g)) assert.ok(["s", "h"].includes(m[1]), `charts.js append(${m[1]}(…))`);
  assert.ok(!/\.append\(\s*\w+\.map\(/.test(src));
});

test("app/: no innerHTML / outerHTML / insertAdjacentHTML", () => {
  for (const f of appFiles) {
    const src = readFileSync(path.join(appDir, f), "utf8");
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(src.replace(/^\/\/.*$/gm, "")), f);
  }
});
