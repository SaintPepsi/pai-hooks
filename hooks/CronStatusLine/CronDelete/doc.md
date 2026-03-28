# CronDelete

## Overview

CronDelete is a **PostToolUse** hook that removes a cron entry from the session state file when the `CronDelete` tool is used. It splices the entry out by ID, deletes the entire session file when the last cron is removed, and appends a "deleted" event to the JSONL log.

This hook handles the explicit deletion path for cron jobs. The companion hooks CronPrune and CronSessionEnd handle cleanup of orphaned and session-ended crons respectively.

## Event

`PostToolUse` — fires after the `CronDelete` tool is used, removing the specified cron entry from the session's cron state file.

## When It Fires

- The tool used is `CronDelete`
- A cron session file exists for the current session
- A cron entry matching the provided ID exists in the session file

It does **not** fire when:

- The tool used is not `CronDelete`
- No cron session file exists for the current session
- No cron entry matches the provided ID

## What It Does

1. Extracts the session ID and cron ID from the tool input
2. Reads the session's cron file; returns `silent` if missing
3. Finds the cron entry by ID; returns `silent` if not found
4. Removes the entry from the crons array
5. If no crons remain, deletes the session file entirely via `removeFile`
6. Otherwise, writes the updated session file with remaining crons
7. Appends a "deleted" event to the JSONL cron log

```typescript
// Remove cron entry by ID
const targetIndex = session.crons.findIndex((c) => c.id === cronId);
if (targetIndex === -1) return ok({ type: "silent" });

session.crons.splice(targetIndex, 1);

if (session.crons.length === 0) {
  deps.removeFile(cronFilePath(sessionId, deps));
} else {
  writeCronFile(sessionId, session, deps, deps);
}
appendCronLog({ type: "deleted", cronId, name: removedCron.name, sessionId }, deps, deps);
```

## Examples

### Example 1: Deleting one of several crons

> A session has 3 registered cron jobs. The user deletes cron "cron-123". CronDelete finds the entry, removes it from the array, writes the updated session file with 2 remaining crons, and logs the "deleted" event.

### Example 2: Deleting the last cron

> A session has 1 remaining cron job. The user deletes it. CronDelete removes the entry, detects the crons array is now empty, deletes the entire session file, and logs the "deleted" event.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `fs` | adapter | File I/O operations including `removeFile` for session file cleanup |
| `shared` | shared | `readCronFile`, `writeCronFile`, `appendCronLog`, `cronFilePath` for cron state management |
| `result` | core | `ok` wrapper for Result type returns |
