# CronFire

## Overview

CronFire is a **UserPromptSubmit** hook that detects cron job firings by matching user prompts against registered session crons. When a prompt contains a cron's trigger text, the hook increments the fire count, records the timestamp, and appends a log event.

This hook fires on every `UserPromptSubmit` event but uses fast-path early exits (no prompt, no session file, no match) to minimize overhead.

## Event

`UserPromptSubmit` — fires when the user submits a prompt, checking if the prompt text matches any registered cron job's trigger prompt.

## When It Fires

- A user prompt is submitted
- A cron session file exists for the current session
- The prompt text contains a registered cron's prompt string (`prompt.includes(cron.prompt)`)

It does **not** fire when:

- The prompt is empty or missing
- No cron session file exists for the current session
- No registered cron's prompt matches the submitted text

## What It Does

1. Extracts the prompt from the input (with legacy `user_prompt` fallback)
2. Returns `silent` immediately if no prompt is present
3. Reads the session's cron file; returns `silent` if missing or unreadable
4. Finds the first cron entry whose prompt string is contained in the user prompt
5. If no match, returns `silent` (no state written)
6. Increments the matched cron's `fireCount` and sets `lastFired` to the current timestamp
7. Writes the updated cron session file
8. Appends a "fired" event to the JSONL cron log

```typescript
// Match prompt against session crons
const matchIndex = sessionFile.crons.findIndex((cron) =>
  prompt.includes(cron.prompt),
);
if (matchIndex === -1) return ok({});

const updatedCron = {
  ...matched,
  fireCount: matched.fireCount + 1,
  lastFired: deps.now(),
};
writeCronFile(sessionId, { ...sessionFile, crons: updatedCrons }, deps, deps);
appendCronLog(
  {
    type: "fired",
    cronId: updatedCron.id,
    name: updatedCron.name,
    fireCount: updatedCron.fireCount,
  },
  deps,
  deps,
);
```

## Examples

### Example 1: Cron prompt matches user input

> A cron job is registered with prompt "check deploy status". The user submits "check deploy status for staging". CronFire matches the cron, increments its fire count from 2 to 3, records the timestamp, and logs a "fired" event.

### Example 2: No matching cron

> The user submits a regular prompt like "Fix the login bug". CronFire reads the session's cron file, finds no cron whose prompt is contained in the input, and returns `silent` without modifying any state.

## Dependencies

| Dependency | Type    | Purpose                                                                    |
| ---------- | ------- | -------------------------------------------------------------------------- |
| `fs`       | adapter | File I/O operations for reading/writing cron state                         |
| `shared`   | shared  | `readCronFile`, `writeCronFile`, `appendCronLog` for cron state management |
| `result`   | core    | `ok` wrapper and `silent` output helper                                    |
