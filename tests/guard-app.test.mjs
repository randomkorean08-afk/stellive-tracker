import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./load.mjs";

const appDir = path.join(ROOT, "app");
const files = readdirSync(appDir).filter((n) => n.endsWith(".js")).map((n) => path.join(appDir, n));
// strip comments so prose in comments cannot trigger/hide matches
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
const read = (f) => strip(readFileSync(f, "utf8"));
const rel = (f) => path.relative(ROOT, f);

test("guard-app: app/*.js files are found", () => {
  assert.ok(files.length >= 8);
});

test("guard-app: no network writes (non-GET fetch, XHR, sendBeacon, WebSocket, EventSource)", () => {
  for (const f of files) {
    const src = read(f);
    assert.ok(!/XMLHttpRequest/.test(src), `${rel(f)}: XMLHttpRequest`);
    assert.ok(!/sendBeacon/.test(src), `${rel(f)}: sendBeacon`);
    assert.ok(!/\bWebSocket\b/.test(src), `${rel(f)}: WebSocket`);
    assert.ok(!/\bEventSource\b/.test(src), `${rel(f)}: EventSource`);
    // any fetch( call: inspect its argument text up to the matching paren
    for (const m of src.matchAll(/\bfetch\s*\(/g)) {
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      for (; i < src.length && depth > 0; i++) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") depth--;
      }
      const args = src.slice(start, i - 1);
      assert.ok(!/\bbody\s*:/.test(args), `${rel(f)}: fetch with body`);
      const method = args.match(/\bmethod\s*:\s*["'`]([A-Za-z]+)["'`]/);
      if (method) assert.equal(method[1].toUpperCase(), "GET", `${rel(f)}: fetch method ${method[1]}`);
      else assert.ok(!/\bmethod\s*:/.test(args), `${rel(f)}: dynamic fetch method`);
    }
  }
});

test("guard-app: no Node module imports", () => {
  const node = /^(node:|fs$|fs\/|path$|child_process$|os$|http$|https$|net$|crypto$|url$|util$|stream$)/;
  for (const f of files) {
    const src = read(f);
    assert.ok(!/\brequire\s*\(/.test(src), `${rel(f)}: require()`);
    assert.ok(!/\bprocess\./.test(src), `${rel(f)}: process.`);
    for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g)) {
      assert.ok(!node.test(m[1]), `${rel(f)}: imports ${m[1]}`);
      assert.ok(m[1].startsWith("./") || m[1].startsWith("../"), `${rel(f)}: non-relative import ${m[1]}`);
    }
  }
});

test("guard-app: persistence only via localStorage keys starting with 'stellive-tracker:'", () => {
  const PREFIX = "stellive-tracker:";
  // Documented exception: store.js availability probe (setItem then immediate removeItem of the same key).
  const PROBE = "__probe";
  for (const f of files) {
    const src = read(f);
    assert.ok(!/\bindexedDB\b/.test(src), `${rel(f)}: indexedDB`);
    assert.ok(!/\bsessionStorage\b/.test(src), `${rel(f)}: sessionStorage`);
    assert.ok(!/document\.cookie\s*=/.test(src), `${rel(f)}: cookie write`);
    assert.ok(!/\bcaches\b\s*\.|serviceWorker/.test(src), `${rel(f)}: cache/serviceWorker`);
    // resolve const string constants in this file
    const consts = Object.fromEntries([...src.matchAll(/\bconst\s+([A-Za-z_]\w*)\s*=\s*["']([^"']*)["']/g)].map((m) => [m[1], m[2]]));
    for (const m of src.matchAll(/\b(?:localStorage|storage)\s*\.\s*(setItem|removeItem|clear)\s*\(\s*([^,)]*)/g)) {
      if (m[1] === "clear") assert.fail(`${rel(f)}: storage.clear()`);
      const arg = m[2].trim();
      const lit = arg.match(/^["']([^"']*)["']$/);
      const key = lit ? lit[1] : consts[arg];
      assert.ok(key !== undefined, `${rel(f)}: unresolvable storage key ${arg}`);
      assert.ok(key.startsWith(PREFIX) || key === PROBE, `${rel(f)}: storage key ${key}`);
    }
  }
});
