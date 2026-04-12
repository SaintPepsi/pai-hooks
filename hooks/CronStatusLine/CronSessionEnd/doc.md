# CronSessionEnd

## Overview

CronSessionEnd is a **SessionEnd** hook that cleans up the current session's cron state file when the session exits cleanly. It reads the file to get the cron count for logging, deletes the file, and appends a "pruned" event with reason "session_ended" to the JSONL log.

This hook handles the clean-exit path. CronPrune (SessionStart) handles orphaned cron files from sessions that exited without proper cleanup.

## Event

`SessionEnd` — fires when a Claude Code session ends normally, removing the session's cron state file and logging the cleanup.

## When It Fires

- A session ends (SessionEnd event)
- A cron state file exists for the current session

It does **not** fire when:

- No cron state file exists for the current session (no cron jobs were created during the session)

## What It Does

1. Constructs the cron file path for the current session
2. Checks if the file exists; returns `silent` if not
3. Reads the cron file to determine the count of active crons (for logging)
4. Deletes the session's cron state file via `removeFile`
5. If deletion fails, logs an error to stderr and returns `silent`
6. Appends a "pruned" event with reason "session_ended" to the JSONL cron log

```typescript
// Clean up session cron file on exit
const path = cronFilePath(sessionId, deps);
if (!deps.fileExists(path)) return ok({});

const cronCount =
  readResult.ok && readResult.value ? readResult.value.crons.length : 0;
deps.removeFile(path);
appendCronLog(
  { type: "pruned", sessionId, cronCount, reason: "session_ended" },
  deps,
  deps,
);
```

## Examples

### Example 1: Session with active crons ends

> A session created 3 cron jobs during its lifetime. When the session ends normally, CronSessionEnd reads the cron file (finding 3 entries), deletes the file, and logs a "pruned" event with `cronCount: 3` and reason "session_ended".

### Example 2: Session with no crons ends

> A session never created any cron jobs, so no cron state file exists. CronSessionEnd checks for the file, finds it missing, and returns `silent` immediately.

## Dependencies

| Dependency | Type    | Purpose                                                                   |
| ---------- | ------- | ------------------------------------------------------------------------- |
| `fs`       | adapter | File I/O operations including `removeFile` for cron file cleanup          |
| `shared`   | shared  | `readCronFile`, `appendCronLog`, `cronFilePath` for cron state management |
| `result`   | core    | `ok` wrapper for Result type returns                                      |
