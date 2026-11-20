// Shared test helper (not a test file). Reads repo data read-only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), "utf8").replace(/^﻿/, ""));
export const clone = (x) => structuredClone(x);
export function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
