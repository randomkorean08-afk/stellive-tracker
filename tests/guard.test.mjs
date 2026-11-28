import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./load.mjs";

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const sources = ["lib", "scripts"].flatMap((d) => walk(path.join(ROOT, d))).filter((p) => p.endsWith(".mjs"));

test("guard: lib/ and scripts/ never write to ratings/overrides/lock/baseline/docs/fixtures", () => {
  assert.ok(sources.length >= 5);
  const forbidden = /(ratings|overrides|channels-lock|playlists|baseline|fixtures|docs)/i;
  for (const f of sources) {
    const src = readFileSync(f, "utf8");
    // every writeFile-like call must not mention a protected target in its argument list
    const re = /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|rename|copyFile|unlink|rm|rmSync)\s*\(([^)]*)\)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      assert.ok(!forbidden.test(m[2]), `${path.relative(ROOT, f)}: ${m[0]}`);
    }
  }
});

test("guard: the only write target in scripts/ is data/videos.json (VIDEOS_PATH)", () => {
  const src = readFileSync(path.join(ROOT, "scripts", "fetch-videos.mjs"), "utf8");
  const calls = [...src.matchAll(/\bwriteFile\s*\(\s*([A-Za-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual(calls, ["VIDEOS_PATH"]);
  assert.match(src, /VIDEOS_PATH\s*=\s*path\.join\(ROOT,\s*"data",\s*"videos\.json"\)/);
});

test("guard: no persisted counters (aggregate fields) in videos.json", () => {
  const v = JSON.parse(readFileSync(path.join(ROOT, "data", "videos.json"), "utf8"));
  const forbiddenKeys = /count|total|slots|average|avg|rank/i;
  for (const k of Object.keys(v)) assert.ok(!forbiddenKeys.test(k) || k === "videos", k);
});

test("guard: no external npm dependencies", () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.type, "module");
  assert.ok(!pkg.dependencies && !pkg.devDependencies);
});

test("guard: lib/ modules used by the browser have no Node-only imports", () => {
  for (const f of ["video-id.mjs", "classify.mjs", "derive.mjs", "draft-guard.mjs", "serialize-export.mjs", "song-search.mjs", "clip-dedupe.mjs"]) {
    const src = readFileSync(path.join(ROOT, "lib", f), "utf8");
    assert.ok(!/from\s+["']node:/.test(src) && !/require\(/.test(src) && !/process\./.test(src), f);
  }
});

test("guard: ai-score.mjs has no Node-only imports and AI scoring scripts only write data/ai-scores.json", () => {
  const aiSrc = readFileSync(path.join(ROOT, "lib", "ai-score.mjs"), "utf8");
  assert.ok(!/from\s+["']node:/.test(aiSrc) && !/require\(/.test(aiSrc) && !/process\./.test(aiSrc), "lib/ai-score.mjs");
  for (const script of ["score-songs.mjs", "import-ai-scores.mjs"]) {
    const src = readFileSync(path.join(ROOT, "scripts", script), "utf8");
    assert.match(src, /AI_SCORES_PATH\s*=\s*path\.join\(ROOT,\s*"data",\s*"ai-scores\.json"\)/, script);
    const writes = [...src.matchAll(/\bwriteFile\s*\(\s*([A-Za-z_]+)/g)].map((m) => m[1]);
    assert.ok(writes.length >= 1 && writes.every((v) => v === "tmpPath" || v === "AI_SCORES_PATH"), `${script}: ${writes}`);
    const renames = [...src.matchAll(/\brename\s*\(\s*[^,]+,\s*([A-Za-z_]+)/g)].map((m) => m[1]);
    assert.deepEqual(renames, ["AI_SCORES_PATH"], script);
  }
});
