import { h, clear, DISCLAIMER, add } from "./dom.js";
import { mergedRatings, mergedOverrides, partialInputs, applyImported, state } from "./store.js";
import { renderStaleNotice } from "./stale-notice.js";
import { validateImport, memberKeysFrom } from "../lib/import-validate.mjs";
import { serializeRatings, serializeOverrides } from "../lib/serialize-export.mjs";

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

export function buildRatingsJson() {
  return serializeRatings(state.repo.ratings, mergedRatings(), {
    exportedAt: new Date().toISOString(),
    disclaimer: DISCLAIMER.replace("큐레이터 개인 평가이며", "큐레이터 개인 평가(Personal Curated Ratings)이며"),
  });
}

export function buildOverridesJson() {
  return serializeOverrides(state.repo.overrides, mergedOverrides());
}

/** Validate an imported file and return {kind, warnings, ...} or {error, errors}. */
export function parseImport(text) {
  let j;
  try { j = JSON.parse(text.replace(/^﻿/, "")); } catch { return { error: "JSON 형식이 아닙니다.", errors: [] }; }
  const repo = state.repo;
  const { errors, warnings } = validateImport(j, {
    memberKeys: memberKeysFrom(repo?.channels),
    videoIds: Object.keys(repo?.videos?.videos ?? {}),
  });
  if (errors.length) {
    const shown = errors.slice(0, 5).map((e) => `${e.path}: ${e.message}`).join(" / ");
    return { error: `가져오기 거부 (오류 ${errors.length}건): ${shown}${errors.length > 5 ? " …" : ""}`, errors, warnings };
  }
  if (j.videoRatings || j.memberRubric) return { kind: "ratings", memberRubric: j.memberRubric ?? {}, videoRatings: j.videoRatings ?? {}, warnings };
  return { kind: "overrides", overrides: j.videos, warnings };
}

function downloadText(name, text) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = h("a", { href: url, download: name });
    add(document.body, a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  } catch { return false; }
}

function exportBlock(name, build, status) {
  const area = h("textarea", { readonly: true, rows: 8, "aria-label": `${name} 미리보기` });
  const msg = (t) => { status.textContent = t; };
  const text = () => { const t = build(); area.value = t; return t; };
  return h("section", { class: "card" },
    h("h3", {}, name),
    h("div", { class: "btn-row" },
      h("button", { type: "button", onclick: () => { msg(downloadText(name, text()) ? `${name} 다운로드를 시도했습니다. 막히면 아래 복사/새 창을 사용하세요.` : "다운로드 실패: 복사 또는 새 창을 사용하세요."); } }, "① 파일 다운로드"),
      h("button", { type: "button", onclick: async () => {
        const t = text();
        try { await navigator.clipboard.writeText(t); msg("클립보드에 복사했습니다."); }
        catch { area.select(); msg("자동 복사가 막혔습니다. 아래 텍스트를 직접 선택해 복사하세요."); }
      } }, "② 클립보드 복사"),
      h("button", { type: "button", onclick: () => {
        const t = text();
        let w = null;
        try { w = window.open(URL.createObjectURL(new Blob([t], { type: "text/plain;charset=utf-8" })), "_blank"); } catch { /* blocked */ }
        msg(w ? "새 창에 JSON을 표시했습니다." : "새 창이 막혔습니다. 아래 텍스트를 사용하세요.");
      } }, "③ 새 창에 표시"),
      h("button", { type: "button", class: "small-btn", onclick: () => { text(); msg("미리보기를 갱신했습니다."); } }, "미리보기 갱신")),
    area,
    h("p", { class: "small muted" }, `GitHub 저장소의 data/${name}을 이 파일로 교체해 커밋하세요.`));
}

export function renderExport(root, rerender) {
  clear(root);
  const status = h("p", { class: "status", role: "status" });
  const partial = partialInputs();
  const stale = h("div", { class: "stale-warn", role: "alert", hidden: true });
  renderStaleNotice(stale, rerender);
  add(root, 
    stale,
    h("p", { class: "banner-inline" }, DISCLAIMER),
    partial.length ? h("p", { class: "warn-text" }, `경고: 멤버 5항목이 부분 입력된 ${partial.length}건이 있습니다. 이 값은 멤버 점수에 반영되지 않습니다(영상 ID: ${partial.slice(0, 3).map((p) => p.id).join(", ")}${partial.length > 3 ? " …" : ""}).`) : null,
    exportBlock("ratings.json", buildRatingsJson, status),
    exportBlock("overrides.json", buildOverridesJson, status),
    status,
  );

  // import
  const preview = h("div", { class: "import-preview" });
  const file = h("input", { type: "file", accept: "application/json,.json", onchange: async (e) => {
    clear(preview);
    const f = e.target.files?.[0];
    if (!f) return;
    const res = parseImport(await f.text());
    if (res.error) { add(preview, h("p", { class: "warn-text" }, res.error)); return; }
    const cur = res.kind === "ratings" ? mergedRatings() : mergedOverrides();
    const diffs = [];
    const cmp = (label, a, b) => {
      for (const k of Object.keys(b ?? {})) {
        const was = a?.[k];
        const same = JSON.stringify(sortKeys(was)) === JSON.stringify(sortKeys(b[k]));
        if (!same) diffs.push(`${label} ${k}: ${was === undefined ? "추가" : "변경"}`);
      }
    };
    if (res.kind === "ratings") { cmp("루브릭", cur.memberRubric, res.memberRubric); cmp("영상", cur.videoRatings, res.videoRatings); }
    else cmp("override", cur.videos, res.overrides);
    add(preview, 
      res.warnings?.length ? h("p", { class: "small muted" }, `경고: ${res.warnings.map((w) => w.path).join(", ")} (알 수 없는 키, 무시됨)`) : null,
      h("p", {}, `${res.kind}.json 미리보기: 변경 ${diffs.length}건`),
      h("ul", { class: "small" }, diffs.slice(0, 50).map((d) => h("li", {}, d))),
      diffs.length ? h("button", { type: "button", onclick: () => { applyImported(res); status.textContent = `초안에 ${diffs.length}건 반영했습니다.`; rerender(); } }, "초안에 반영") : null);
  } });
  add(root, h("section", { class: "card" }, h("h3", {}, "가져오기"), h("p", { class: "small muted" }, "ratings.json / overrides.json 파일을 선택하면 검증 후 변경 내용을 미리 보여주고, 확인하면 초안에 반영합니다."), file, preview));
}
