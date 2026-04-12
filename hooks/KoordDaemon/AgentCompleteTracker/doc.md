# AgentCompleteTracker

## Overview

AgentCompleteTracker is an **async PostToolUse** hook that notifies the Koord daemon when a background agent completes its work. It fires after the Agent tool finishes and specifically handles completion events (not spawns), extracting the `thread_id` from the tool output and top-level input to POST to the daemon's `/complete` endpoint.

This hook works as a pair with AgentSpawnTracker: AgentSpawnTracker handles `/spawn` notifications when agents are created, while AgentCompleteTracker handles `/complete` notifications when they finish.

## Event

`PostToolUse` — fires after the Agent tool completes, notifying the Koord daemon that a background agent has finished its task.

## When It Fires

- The `tool_name` is `"Agent"`
- The tool input does NOT have `run_in_background: true` (completion events, not spawns)
- A valid `thread_id` (17-20 digit Discord snowflake) is found in `tool_output` or top-level input
- A daemon URL is configured via env var or settings.json

It does **not** fire when:

- The tool is not the Agent tool
- `run_in_background: true` is set in `tool_input` (spawn events are handled by AgentSpawnTracker)
- No `thread_id` is found in the tool output or top-level input
- No daemon URL is configured

## What It Does

1. Checks `accepts()`: only proceeds for `tool_name === "Agent"`
2. Skips if `tool_input.run_in_background === true` (spawn event, not completion)
3. Extracts `thread_id` from `tool_output` and top-level input fields using `extractThreadIdFromOutput`
4. Resolves daemon URL from `KOORD_DAEMON_URL` env var, falling back to settings.json
5. POSTs `{ thread_id }` to `{daemonUrl}/complete` with a 3-second timeout
6. Returns `ok({})` regardless of success or failure (never blocks)

```typescript
// Skip spawn events — those are handled by AgentSpawnTracker
if (input.tool_input.run_in_background === true) {
  return ok({});
}

const threadId = extractThreadIdFromOutput(record);
// POST to daemon /complete endpoint
const url = `${baseUrl}/complete`;
const body = JSON.stringify({ thread_id: threadId });
```

## Examples

### Example 1: Background agent finishes work

> A background agent spawned via the Agent tool completes its task. The PostToolUse event fires with the Agent tool's output containing `thread_id: "1234567890123456789"`. AgentCompleteTracker extracts the thread ID and POSTs `{ thread_id: "1234567890123456789" }` to the daemon's `/complete` endpoint, allowing the daemon to update its tracking state.

### Example 2: Agent spawn event (skipped)

> The Agent tool is invoked with `run_in_background: true` to spawn a new background agent. AgentCompleteTracker detects the spawn flag and immediately returns `ok({})`, leaving the notification to AgentSpawnTracker.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `result` | core | `ok()` for Result wrapping |
| `fetch` | adapter | `safeFetch` for HTTP POST with timeout |
| `KoordDaemon/shared` | shared | `extractThreadIdFromOutput`, `readKoordConfig`, `defaultReadFileOrNull` |
| `paths` | lib | Path resolution utilities |
