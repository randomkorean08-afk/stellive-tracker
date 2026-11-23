# Stellive Music Tracker — Agent Team Rules

## Team
- **Lead (Claude Code, main session)**: PM, architecture, DB integrity, final review, merges. Sole decision-maker.
- **Claude workers**: `claude/claude-sonnet-5-5` by default for design, implementation and review tasks (token saving).
  Opus only when the lead explicitly escalates a hard problem.
- **Vocal specialist**: Paseo `antigravity/gemini-4-hydrogen-high`. Research and structured reports only.
  Runs in a sandbox copy outside this folder (full-access mode cannot be permission-restricted).

## Hard rules
1. The lead decides. Workers and the specialist propose; they do not merge.
2. The specialist reports to the lead via `reports/vocal/*.md` in its sandbox. Nothing from the sandbox is copied
   into this project except what the lead reviews.
3. The specialist never writes, deletes or migrates anything in `data/`.
4. Every change to the app is reviewed by the lead (diff + `npm test` green, currently 152/152).
5. Protected data — never modify without explicit user approval:
   `data/ratings.json`, `data/overrides.json`, `data/channels-lock.json`, `data/playlists.json`, `data/baseline/**`, `tests/fixtures/**`.
   The 604-track figure lives in `data/baseline/baseline-2026-11-17.json` (member-slot count, read-only reference).
   `data/videos.json` is written only by `scripts/fetch-videos.mjs` (merge never deletes).
6. Independent implementation tasks use separate Git worktrees (repo: C:devstellive-tracker).
7. Destructive changes, schema changes (`schemaVersion`), or data migrations require user approval first.
8. New phases start with read-only inspection and a plan.

## Commands
- Tests: `npm test` (node --test, no deps). Keep `tests/guard.test.mjs` passing — it enforces rule 5 in code.
