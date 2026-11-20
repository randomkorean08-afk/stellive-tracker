// Locks the original PDF values ("StelLive 604-Track Archive & Vocal Evaluation Report.pdf", 2026-11-17).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readJson } from "./load.mjs";
import { RUBRIC_ITEMS } from "../lib/derive.mjs";

const ratings = readJson("data/ratings.json");
const baseline = readJson("data/baseline/baseline-2026-11-17.json");
const DATE = "2026-11-17";

const SONG = {
  "R_B4tmy2DVA": 98.4, "CyOAmEihVHs": 97.9, "liPEQZJLQh4": 97.2, "FzefgoF26Ac": 96.5, "v094-E3Pmtk": 96.8,
  "of5l0st1kA8": 98.1, "iCCqSFvz9kM": 96.9, "zNYEbJr1xj4": 97.4, "eSI7RsjZy1E": 97.5, "Ei7yWYi7x_E": 94.2,
  "8lD-6Xyq4Lg": 95.4, "L1haw5kPB7Q": 94.8, "EIii4EXsfsU": 95.1, "O1MqvWf7q58": 94.0, "Qi_JLmXBFFo": 93.4,
  "fLLX2R-RwVE": 93.2, "bJqdy8925Oc": 91.8, "3Xf1Wt7Z-RY": 90.9, "MZNKiadMo3U": 91.2, "ojV55hcIc4w": 89.6,
  "_8uoathMY0A": 89.5, "G5tTozKJRD4": 89.8, "E_G9otMLf64": 88.9, "ouKcRBeyKbk": 86.2, "eeIMg68ug9Y": 85.4,
  "iAoU1UGPoXc": 85.8, "kNzGpNEdBqw": 83.5,
};

const ORDER = ["vocalization", "pitch", "rhythm", "range", "volume", "tone", "technique", "expression", "breath", "live"];
const RUBRIC = {
  "akane-lize": [14.3, 9.5, 9.5, 9.7, 9.3, 9.9, 9.8, 9.9, 9.1, 4.8],
  "airi-kanna": [14.4, 9.4, 9.4, 9.6, 9.8, 9.6, 9.5, 9.8, 9.3, 4.7],
  "tokino-meri": [14.6, 9.7, 9.5, 9.6, 9.7, 9.1, 9.2, 9.2, 9.6, 4.8],
  "hanako-nana": [13.9, 9.3, 9.8, 9.4, 9.2, 9.4, 9.3, 9.4, 9.5, 4.6],
  "shirayuki-hina": [13.5, 9.4, 9.0, 9.2, 8.4, 9.7, 9.4, 9.6, 8.9, 4.4],
  "aokumo-rin": [13.8, 9.3, 9.3, 8.9, 8.9, 9.3, 8.9, 9.0, 9.0, 4.6],
  "yuzuha-riko": [13.6, 9.2, 9.0, 8.7, 9.3, 9.2, 8.8, 9.0, 8.9, 4.4],
  "tenko-shibuki": [13.1, 8.9, 8.8, 9.0, 8.6, 9.1, 8.8, 9.2, 8.5, 4.1],
  "shizuki-toa": [13.1, 8.8, 9.2, 8.7, 8.8, 9.1, 8.7, 8.9, 8.4, 4.0],
  "neneko-mashiro": [12.9, 8.8, 8.9, 8.8, 8.1, 9.3, 8.5, 9.0, 8.3, 4.1],
  "arahashi-tabi": [12.8, 8.6, 8.9, 8.5, 8.6, 9.2, 8.6, 9.0, 8.2, 4.0],
  "hanayo-hiyori": [12.3, 8.5, 8.3, 8.3, 7.8, 8.9, 8.2, 8.6, 8.0, 3.8],
  "sakihane-fuya": [12.2, 8.4, 8.5, 8.2, 7.8, 8.8, 8.0, 8.3, 7.9, 3.8],
  "kogane-rang": [12.0, 8.1, 8.8, 8.0, 8.2, 8.8, 8.0, 8.3, 7.8, 3.7],
  "ayatsuno-yuni": [11.5, 7.8, 8.2, 7.6, 7.6, 9.1, 7.5, 8.5, 7.6, 3.6],
};

const TOTALS = {
  "akane-lize": 64, "airi-kanna": 31, "tokino-meri": 6, "hanako-nana": 65, "shirayuki-hina": 64,
  "aokumo-rin": 74, "yuzuha-riko": 75, "tenko-shibuki": 46, "shizuki-toa": 6, "neneko-mashiro": 65,
  "arahashi-tabi": 44, "hanayo-hiyori": 6, "sakihane-fuya": 16, "kogane-rang": 6, "ayatsuno-yuni": 36,
};

test("baseline-lock: all 27 original PDF video IDs are preserved in videoRatings", () => {
  assert.equal(Object.keys(SONG).length, 27);
  for (const id of Object.keys(SONG)) assert.ok(id in ratings.videoRatings, `missing ${id}`);
});

test("baseline-lock: videoRatings dated 2026-11-17 equal the PDF songScore and are only the 27 IDs", () => {
  const dated = Object.entries(ratings.videoRatings).filter(([, v]) => v.ratedAt === DATE).map(([k]) => k);
  for (const id of dated) assert.equal(ratings.videoRatings[id].songScore, SONG[id], id);
  assert.ok(dated.every((id) => id in SONG), `unexpected dated entries: ${dated.filter((i) => !(i in SONG))}`);
});

test("baseline-lock: memberRubric dated 2026-11-17 equals the PDF values", () => {
  for (const [m, vals] of Object.entries(RUBRIC)) {
    const e = ratings.memberRubric[m];
    assert.ok(e, `missing member ${m}`);
    if (e.ratedAt !== DATE) continue;
    assert.deepEqual(ORDER.map((k) => e.items[k]), vals, m);
  }
  for (const [m, e] of Object.entries(ratings.memberRubric)) {
    if (e.ratedAt === DATE) assert.ok(m in RUBRIC, `unexpected dated member ${m}`);
  }
});

test("baseline-lock: reportedCounts total 604 with per-member totals", () => {
  const rc = baseline.reportedCounts;
  assert.deepEqual(Object.fromEntries(Object.entries(rc).map(([m, c]) => [m, c.total])), TOTALS);
  assert.equal(Object.values(rc).reduce((s, c) => s + c.total, 0), 604);
});

test("baseline-lock: rubric keeps the 55/45 physical/interpretive split", () => {
  assert.deepEqual(RUBRIC_ITEMS.map((i) => i.key), ORDER);
  const sum = (g) => RUBRIC_ITEMS.filter((i) => i.group === g).reduce((s, i) => s + i.max, 0);
  assert.equal(sum("physical"), 55);
  assert.equal(sum("interpretive"), 45);
});
