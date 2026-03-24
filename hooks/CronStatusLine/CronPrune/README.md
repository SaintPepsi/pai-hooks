# CronPrune Hook

**Event:** SessionStart (no matcher — fires on every session start)
**Contract:** `CronPrune.contract.ts`
**Output:** Silent

Scans `MEMORY/STATE/crons/` on session start and removes files with mtime older than 5 minutes
(`PRUNE_THRESHOLD_MS` in contract). Dead sessions stop rendering the status line, so their cron
files stop being touched — the mtime threshold reliably identifies them.

Reads each stale file before deletion to extract session ID and cron count for the JSONL log.
Appends a `pruned` event with `reason: "session_dead"` via `appendCronLog()` from `shared.ts`.

See `CronPrune.test.ts` for behavior coverage (10 tests).
