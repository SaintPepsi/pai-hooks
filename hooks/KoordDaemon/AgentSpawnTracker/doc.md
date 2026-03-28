# AgentSpawnTracker

## Overview

AgentSpawnTracker is an **async PostToolUse** hook that notifies the Koord daemon when a background agent is spawned. It fires after the Agent tool is invoked with `run_in_background: true`, extracting the agent name, thread ID, and task description from the tool input to POST to the daemon's `/spawn` endpoint.

This hook works as a pair with AgentCompleteTracker: AgentSpawnTracker handles `/spawn` notifications at creation time, while AgentCompleteTracker handles `/complete` notifications when agents finish.

## Event

`PostToolUse` — fires after the Agent tool is invoked with `run_in_background: true`, notifying the Koord daemon that a new background agent has been spawned.

## When It Fires

- The `tool_name` is `"Agent"`
- The tool input has `run_in_background: true` (spawn event)
- A valid `thread_id` (17-20 digit Discord snowflake) is extracted from tool input
- A daemon URL is configured via env var or settings.json

It does **not** fire when:

- The tool is not the Agent tool
- `run_in_background` is not set or is false (completion events are handled by AgentCompleteTracker)
- No valid `thread_id` (Discord snowflake) is found in tool input
- No daemon URL is configured

## What It Does

1. Checks `accepts()`: only proceeds for `tool_name === "Agent"`
2. Skips if `run_in_background` is not true in tool input
3. Extracts `thread_id` via `extractThreadId` — requires a valid Discord snowflake; skips if missing
4. Extracts `agent_name` (defaults to `"background-agent"`) and `task` from tool input
5. Resolves daemon URL from `KOORD_DAEMON_URL` env var, falling back to settings.json
6. POSTs `{ thread_id, agent_name, task }` to `{daemonUrl}/spawn` with a 3-second timeout

```typescript
// Only fire for background agents
if (!toolInput.run_in_background) {
  return ok(continueOk());
}

const threadId = extractThreadId(toolInput);
const agentName = extractAgentName(toolInput) ?? "background-agent";
const task = extractTask(toolInput);

// POST to daemon /spawn endpoint
const url = `${baseUrl}/spawn`;
```

## Examples

### Example 1: Background agent spawned with thread ID

> Claude spawns a background agent with `run_in_background: true` and a prompt containing `thread_id: "1234567890123456789"`. AgentSpawnTracker extracts the thread ID, agent name, and task, then POSTs `{ thread_id: "1234567890123456789", agent_name: "code-reviewer", task: "Review PR changes" }` to the daemon's `/spawn` endpoint.

### Example 2: Missing thread ID (skipped)

> A background agent is spawned but the tool input does not contain a valid Discord snowflake thread ID. AgentSpawnTracker logs a warning and returns `continueOk()` without calling the daemon, avoiding pollution of delegation tracking with invalid data.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `result` | core | `ok()` for Result wrapping |
| `types/hook-outputs` | core | `continueOk()` for non-blocking continue output |
| `fetch` | adapter | `safeFetch` for HTTP POST with timeout |
| `KoordDaemon/shared` | shared | `extractThreadId`, `extractAgentName`, `extractTask`, `readKoordConfig`, `defaultReadFileOrNull` |
| `paths` | lib | Path resolution utilities |
