// Data loading, local draft (localStorage with in-memory fallback) and merged views of repo data + draft.
// The browser never writes repository files: edits live in the draft and leave only via export.
import { deriveAll, memberVideoScore, VIDEO_ITEMS } from "../lib/derive.mjs";

const DRAFT_KEY = "stellive-tracker:draft:v1";
const emptyDraft = () => ({ ratings: { memberRubric: {}, videoRatings: {} }, overrides: { videos: {} }, updatedAt: null });
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const round1 = (v) => Math.round(v * 10) / 10;

let storage = null;
try {
  storage = window.localStorage;
  storage.setItem("__probe", "1");
  storage.removeItem("__probe");
} catch {
  storage = null;
}
export const storageOk = storage !== null;

export const state = { repo: null, draft: emptyDraft() };
const listeners = new Set();
let cache = null;

export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

function changed() {
  cache = null;
  state.draft.updatedAt = new Date().toISOString();
  persist();
  for (const fn of listeners) fn();
}

function persist() {
  if (!storage) return;
  try { storage.setItem(DRAFT_KEY, JSON.stringify(state.draft)); } catch { /* quota or blocked: keep memory mode */ }
}

function loadDraft() {
  if (!storage) return;
  try {
    const raw = storage.getItem(DRAFT_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    state.draft = {
      ratings: { memberRubric: d?.ratings?.memberRubric ?? {}, videoRatings: d?.ratings?.videoRatings ?? {} },
      overrides: { videos: d?.overrides?.videos ?? {} },
      updatedAt: d?.updatedAt ?? null,
    };
  } catch { /* corrupt draft: ignore */ }
}

async function getJson(url, fallback) {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw new Error(`${url}: ${e.message}`);
  }
}

export async function loadAll() {
  const [channels, videos, overrides, ratings, baseline] = await Promise.all([
    getJson("./data/channels-lock.json"),
    getJson("./data/videos.json"),
    getJson("./data/overrides.json", { schemaVersion: 1, videos: {} }),
    getJson("./data/ratings.json", { schemaVersion: 1, memberRubric: {}, videoRatings: {} }),
    getJson("./data/baseline/baseline-2026-11-17.json", null),
  ]);
  state.repo = { channels, videos, overrides, ratings, baseline };
  loadDraft();
  cache = null;
}

// ---- merged views (draft over repo; null in draft = tombstone) ----
function overlay(base, over) {
  const out = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(over ?? {})) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}
export const mergedRatings = () => ({
  ...state.repo.ratings,
  memberRubric: overlay(state.repo.ratings.memberRubric, state.draft.ratings.memberRubric),
  videoRatings: overlay(state.repo.ratings.videoRatings, state.draft.ratings.videoRatings),
});
export const mergedOverrides = () => ({
  ...state.repo.overrides,
  videos: overlay(state.repo.overrides.videos, state.draft.overrides.videos),
});

export function derived() {
  if (!cache) {
    const { channels, videos, baseline } = state.repo;
    cache = deriveAll({ channels, videos, overrides: mergedOverrides(), ratings: mergedRatings(), baseline });
  }
  return cache;
}

export const dirtyCount = () =>
  Object.keys(state.draft.ratings.memberRubric).length +
  Object.keys(state.draft.ratings.videoRatings).length +
  Object.keys(state.draft.overrides.videos).length;

export function discardDraft() {
  state.draft = emptyDraft();
  cache = null;
  persist();
  for (const fn of listeners) fn();
}

// ---- video ratings ----
export const getVideoRating = (id) => mergedRatings().videoRatings[id] ?? null;

function editVideoRating(id, mutate) {
  const cur = clone(mergedRatings().videoRatings[id]) ?? { songScore: null, members: {}, ratedAt: today(), note: "" };
  cur.members ??= {};
  mutate(cur);
  for (const [m, items] of Object.entries(cur.members)) if (!Object.keys(items).length) delete cur.members[m];
  cur.ratedAt = today();
  const empty = cur.songScore === null && !Object.keys(cur.members).length;
  const inRepo = id in state.repo.ratings.videoRatings;
  if (empty) {
    if (inRepo) state.draft.ratings.videoRatings[id] = null; // tombstone: back to unrated
    else delete state.draft.ratings.videoRatings[id];
  } else state.draft.ratings.videoRatings[id] = cur;
  changed();
}

export const setSongScore = (id, v) => editVideoRating(id, (r) => { r.songScore = v === null ? null : round1(v); });
export const setMemberItem = (id, m, key, v) =>
  editVideoRating(id, (r) => {
    r.members[m] ??= {};
    if (v === null) delete r.members[m][key];
    else r.members[m][key] = round1(v);
  });
export const clearMemberVideo = (id, m) => editVideoRating(id, (r) => { delete r.members[m]; });

/** Partial member-score inputs (1-4 of 5 items) that derive ignores; shown as warnings. */
export function partialInputs() {
  const out = [];
  for (const [id, r] of Object.entries(mergedRatings().videoRatings)) {
    for (const [m, items] of Object.entries(r.members ?? {})) {
      if (Object.keys(items).length && memberVideoScore(m, id, mergedRatings()) === null) out.push({ id, member: m, filled: VIDEO_ITEMS.filter((i) => i.key in items).length });
    }
  }
  return out;
}

// ---- member rubric ----
export function setRubricItem(member, key, v) {
  const cur = clone(mergedRatings().memberRubric[member]) ?? { items: {}, ratedAt: today(), source: "manual" };
  if (v === null) delete cur.items[key];
  else cur.items[key] = round1(v);
  cur.ratedAt = today();
  cur.source = "manual";
  state.draft.ratings.memberRubric[member] = cur;
  changed();
}

// ---- overrides ----
export function setOverride(id, entry) {
  const inRepo = id in state.repo.overrides.videos;
  if (entry === null) {
    if (inRepo) state.draft.overrides.videos[id] = null;
    else delete state.draft.overrides.videos[id];
  } else state.draft.overrides.videos[id] = entry;
  changed();
}

// ---- import (already validated by caller) ----
export function applyImported({ memberRubric, videoRatings, overrides }) {
  for (const [k, v] of Object.entries(memberRubric ?? {})) state.draft.ratings.memberRubric[k] = v;
  for (const [k, v] of Object.entries(videoRatings ?? {})) state.draft.ratings.videoRatings[k] = v;
  for (const [k, v] of Object.entries(overrides ?? {})) state.draft.overrides.videos[k] = v;
  changed();
}
