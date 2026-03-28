# VoiceGate

## Overview

VoiceGate is a **PreToolUse** hook that prevents subagent sessions from accessing the voice notification server. Only the main session is permitted to reach `localhost:8888` (the Kokoro TTS voice server). Subagent sessions are blocked to prevent duplicate or unexpected TTS notifications when multiple agents are running in parallel.

The hook uses the `CLAUDE_CODE_AGENT_SUBAGENT` environment variable to determine whether the current session is a subagent.

## Event

`PreToolUse` — fires before a Bash tool call executes, blocking voice server requests from subagent sessions.

## When It Fires

- The Bash command contains `localhost:8888` (the voice server endpoint)
- The session is determined to be a subagent (`CLAUDE_CODE_AGENT_SUBAGENT=true`)

It does **not** fire when:

- The command does not reference `localhost:8888`
- The session is the main session (not a subagent)
- The tool is not Bash

## What It Does

1. Checks if the command contains `localhost:8888` (accepts gate)
2. Determines if the current session is a subagent via `CLAUDE_CODE_AGENT_SUBAGENT` env var
3. If the session is the main session, returns `continue` to allow the request
4. If the session is a subagent, returns `block` with a descriptive reason

```typescript
accepts(input: ToolHookInput): boolean {
  const command = (input.tool_input?.command as string) || "";
  return command.includes("localhost:8888");
}
```

## Examples

### Example 1: Subagent voice request blocked

> A subagent spawned to handle a parallel task attempts to access the voice server at `localhost:8888/notify`. VoiceGate detects `CLAUDE_CODE_AGENT_SUBAGENT=true` and blocks the command with: "Voice server access is restricted to the main session."

### Example 2: Main session voice request allowed

> The main session sends a request to `localhost:8888/notify`. VoiceGate confirms the session is not a subagent and returns `continue`, allowing the request to proceed.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `fs` | adapter | Provides `fileExists` for dependency injection |
| `result` | core | Provides `ok` and `Result` type for error handling |
