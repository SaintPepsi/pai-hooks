# CronCreate

## Overview

CronCreate is a **PostToolUse** hook that persists new cron job entries to the session state file when the `CronCreate` tool is used. It extracts cron metadata from the tool input and response, builds a `CronEntry`, appends it to the session's cron file, and logs a "created" event to the JSONL log.

This hook works alongside CronFire (which detects firings), CronDelete (which removes entries), CronPrune (which cleans up orphans), and CronSessionEnd (which handles clean session exits).

## Event

`PostToolUse` — fires after the `CronCreate` tool is used, persisting the new cron entry to the session's state file.

## When It Fires

- The tool used is `CronCreate`

It does **not** fire when:

- The tool used is not `CronCreate`

## What It Does

1. Extracts the session ID and current timestamp
2. Extracts the cron ID from `tool_response.id` (falls back to `cron-{timestamp}`)
3. Extracts the human-readable name from `tool_response.humanSchedule` (falls back to "Cron job")
4. Extracts schedule, recurring flag, and prompt from `tool_input`
5. Builds a `CronEntry` with the extracted fields, initial `fireCount: 0`, and `lastFired: null`
6. Reads the existing session cron file or creates a new one
7. Appends the new entry and writes the updated session file
8. Appends a "created" event to the JSONL cron log

```typescript
// Build and persist new cron entry
const entry: CronEntry = {
  id: cronId, name, schedule, recurring, prompt,
  createdAt: now, fireCount: 0, lastFired: null,
};
const session = readResult.value ?? { sessionId, crons: [] };
session.crons.push(entry);
writeCronFile(sessionId, session, deps, deps);
appendCronLog({ type: "created", cronId, name, schedule, sessionId }, deps, deps);
```

## Examples

### Example 1: Creating a recurring cron job

> The user sets up a cron job to check deploy status every 5 minutes. The CronCreate tool fires with `schedule: "*/5 * * * *"`, `prompt: "check deploy status"`, and `recurring: true`. CronCreate persists the entry and logs the creation.

### Example 2: Creating a one-shot cron job

> The user creates a one-time reminder with `recurring: false`. CronCreate persists the entry with the same flow. The entry will be tracked until the session ends or it is explicitly deleted.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `fs` | adapter | File I/O operations for reading/writing cron state |
| `shared` | shared | `readCronFile`, `writeCronFile`, `appendCronLog`, `CronEntry`, `CronSessionFile` types |
| `result` | core | `ok` wrapper for Result type returns |
