import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsvRows, parseInputRecords, importAiScores, IMPORT_MODEL, IMPORT_PROMPT_VERSION } from "../scripts/import-ai-scores.mjs";
import { deriveAll } from "../lib/derive.mjs";
import { readJson } from "./load.mjs";

const lock = readJson("data/channels-lock.json");
const videos = readJson("data/videos.json");
const overrides = readJson("data/overrides.json");
const ratings = readJson("data/ratings.json");
const baseline = readJson("data/baseline/baseline-2026-11-17.json");

const sampleRow = (videoId, member, v = 9) => ({
  videoId,
  member,
  vocalization: 14,
  pitch: v,
  rhythm: v,
  range: v,
  volume: v,
  tone: v,
  technique: v,
  expression: v,
  breath: v,
  live: 4.5,
});

test("CSV parser: UTF-8 BOM, CRLF, and Korean member display name mapping", () => {
  const csv = "\uFEFFvideoId,member,vocalization,pitch,rhythm,range,volume,tone,technique,expression,breath,live\r\n" +
    "R_B4tmy2DVA,아카네 리제,14.3,9.5,9.5,9.7,9.3,9.9,9.8,9.9,9.1,4.8\r\n";
  const records = parseCsvRows(csv);
  assert.equal(records.length, 1);
  assert.equal(records[0].member, "아카네 리제");

  const res = importAiScores({
    records,
    videos,
    overrides,
    lock,
    aiScores: { schemaVersion: 1, scoreSince: "2026-11-28T00:00:00Z", usage: {}, videos: {} },
    now: "2026-11-28T12:00:00Z",
    log: () => {},
    warn: () => {},
  });
  assert.equal(res.imported, 1);
  assert.equal(res.rejected.length, 0);
  const entry = res.doc.videos.R_B4tmy2DVA;
  assert.equal(entry.model, IMPORT_MODEL);
  assert.equal(entry.promptVersion, IMPORT_PROMPT_VERSION);
  assert.equal(entry.scoredAt, "2026-11-28T12:00:00Z");
  assert.equal(entry.members["akane-lize"].items.vocalization, 14.3);
  assert.equal(entry.members["akane-lize"].items.live, 4.8);
});

test("JSON input + validation: unknown videoId, non-member of video, out-of-range scores rejected", () => {
  const jsonText = JSON.stringify([
    sampleRow("NOT_IN_VIDEOS", "akane-lize"),           // unknown videoId
    sampleRow("R_B4tmy2DVA", "ayatsuno-yuni"),            // not an effective member of R_B4tmy2DVA (akane-lize solo)
    sampleRow("R_B4tmy2DVA", "없는멤버"),                  // unknown member name
    { ...sampleRow("R_B4tmy2DVA", "akane-lize"), vocalization: 15.1 }, // > 15
    { ...sampleRow("R_B4tmy2DVA", "akane-lize"), live: 5.5 },          // > 5
    { ...sampleRow("R_B4tmy2DVA", "akane-lize"), pitch: -0.1 },        // < 0
    { ...sampleRow("R_B4tmy2DVA", "akane-lize"), tone: "bad" },        // non-numeric
  ]);
  const records = parseInputRecords(jsonText, "scores.json");
  const res = importAiScores({
    records,
    videos,
    overrides,
    lock,
    aiScores: { schemaVersion: 1, videos: {} },
    log: () => {},
    warn: () => {},
  });
  assert.equal(res.imported, 0);
  assert.equal(res.rejected.length, 7);
  assert.equal(res.changed, false);
});

test("duplicate rows: last wins with warning", () => {
  const warnings = [];
  const res = importAiScores({
    records: [
      sampleRow("R_B4tmy2DVA", "akane-lize", 7.0),
      sampleRow("R_B4tmy2DVA", "아카네 리제", 9.2),
    ],
    videos,
    overrides,
    lock,
    aiScores: { schemaVersion: 1, videos: {} },
    log: () => {},
    warn: (w) => warnings.push(w),
  });
  assert.equal(res.imported, 1);
  assert.equal(warnings.length, 1);
  assert.equal(res.doc.videos.R_B4tmy2DVA.members["akane-lize"].items.pitch, 9.2);
});

test("dryRun and overwrite behavior: existing entries preserved unless --overwrite", () => {
  const first = importAiScores({
    records: [sampleRow("R_B4tmy2DVA", "akane-lize", 8.0)],
    videos,
    overrides,
    lock,
    aiScores: { schemaVersion: 1, videos: {} },
    dryRun: true,
    log: () => {},
    warn: () => {},
  });
  assert.equal(first.dryRun, true);
  assert.equal(first.imported, 1);

  const baseDoc = first.doc;

  // Without overwrite: rejected
  const blocked = importAiScores({
    records: [sampleRow("R_B4tmy2DVA", "akane-lize", 9.9)],
    videos,
    overrides,
    lock,
    aiScores: baseDoc,
    overwrite: false,
    log: () => {},
    warn: () => {},
  });
  assert.equal(blocked.imported, 0);
  assert.equal(blocked.rejected.length, 1);
  assert.equal(blocked.doc.videos.R_B4tmy2DVA.members["akane-lize"].items.pitch, 8.0);

  // With overwrite: updated
  const replaced = importAiScores({
    records: [sampleRow("R_B4tmy2DVA", "akane-lize", 9.9)],
    videos,
    overrides,
    lock,
    aiScores: baseDoc,
    overwrite: true,
    log: () => {},
    warn: () => {},
  });
  assert.equal(replaced.imported, 1);
  assert.equal(replaced.doc.videos.R_B4tmy2DVA.members["akane-lize"].items.pitch, 9.9);

  // Imported entry blends in deriveAll just like bot-scored entries
  const dBefore = deriveAll({ channels: lock, videos, overrides, ratings, baseline });
  const dAfter = deriveAll({ channels: lock, videos, overrides, ratings, baseline, aiScores: replaced.doc });
  assert.equal(dAfter.memberCards.find((c) => c.key === "akane-lize").aiSongsN, 1);
  assert.notEqual(
    dAfter.memberCards.find((c) => c.key === "akane-lize").rubricItems.pitch,
    dBefore.memberCards.find((c) => c.key === "akane-lize").rubricItems.pitch,
  );
});
