# CronPrune

## Overview

CronPrune is a **SessionStart** hook that removes orphaned cron files left behind by dead sessions. It scans the cron state directory for `.json` files whose modification time exceeds a dynamic threshold, deletes them, and logs the pruning event.

The prune threshold is computed dynamically as 2x the longest cron interval found in each session file, falling back to a default of 5 minutes. This ensures that sessions with long-interval crons are not prematurely pruned. CronSessionEnd handles clean exits; CronPrune handles the unclean-exit case.

## Event

`SessionStart` — fires when a new Claude Code session begins, cleaning up stale cron files from sessions that exited without proper cleanup.

## When It Fires

- A new session starts
- The cron state directory exists and contains `.json` files
- At least one file's modification time exceeds its computed prune threshold

It does **not** fire when:

- The cron state directory does not exist
- No `.json` files are present in the cron directory
- All session files have been modified recently (within their prune threshold)

## What It Does

1. Checks if the cron state directory exists; returns `silent` if not
2. Lists all `.json` files in the directory
3. For each file:
   - Stats the file to get its modification time
   - Reads and parses the file to extract cron schedules
   - Computes a dynamic prune threshold (2x the longest cron interval via `cronIntervalMs`)
   - Falls back to the default threshold (5 minutes) if no schedules are parseable
   - If the file age exceeds the threshold, deletes it and logs a "pruned" event

```typescript
// Dynamic threshold based on cron schedules
for (const cron of parsed.value.crons) {
  const intervalMs = cronIntervalMs(cron.schedule);
  if (intervalMs > longestCronMs) longestCronMs = intervalMs;
}
const pruneThreshold = longestCronMs > 0 ? longestCronMs * 2 : DEFAULT_PRUNE_THRESHOLD_MS;

if (ageMs > pruneThreshold) {
  deps.removeFile(filePath);
  appendCronLog({ type: "pruned", sessionId, cronCount, reason: "session_dead" }, deps, deps);
}
```

## Examples

### Example 1: Pruning a stale session file

> A previous session crashed without running CronSessionEnd. Its cron file in `MEMORY/STATE/crons/` has not been modified for 10 minutes and contained only 1-minute interval crons (threshold: 2 minutes). On the next session start, CronPrune detects the staleness, deletes the file, and logs a "pruned" event with reason "session_dead".

### Example 2: Long-interval cron preserved

> A session file contains a cron with a `0 */6 * * *` schedule (every 6 hours). CronPrune computes the threshold as 12 hours (2x 6 hours). The file is only 2 hours old, so it is preserved.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `fs` | adapter | File I/O operations including `stat` for mtime checks and `removeFile` for cleanup |
| `error` | core | `jsonParseFailed` error constructor for safe JSON parsing |
| `shared` | shared | `cronDir`, `appendCronLog` for cron directory resolution and logging |
| `result` | core | `ok`, `tryCatch` for Result type operations |
