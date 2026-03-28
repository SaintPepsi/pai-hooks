# VoiceGate

## Overview

VoiceGate is a **PreToolUse** hook that prevents subagent sessions from sending voice notifications. Only the main terminal session is permitted to curl `localhost:8888` (the voice notification endpoint). Subagent sessions are blocked silently to prevent duplicate or unexpected voice notifications when multiple agents are running in parallel.

The hook determines whether a session is the "main" session by checking terminal environment variables (iTerm, Warp, Alacritty, Apple Terminal) or by looking for a persisted Kitty session file.

## Event

`PreToolUse` — fires before a Bash tool call executes, blocking voice notification curls from subagent sessions.

## When It Fires

- The Bash command contains `localhost:8888` (the voice notification endpoint)
- The session is determined to be a subagent (not the main terminal session)

It does **not** fire when:

- The command does not reference `localhost:8888`
- The session is the main terminal session (identified by terminal environment variables or Kitty session file)
- The tool is not Bash

## What It Does

1. Checks if the command contains `localhost:8888` (accepts gate)
2. Determines if the current session is the main session by checking:
   - `TERM_PROGRAM` is iTerm.app, WarpTerminal, Alacritty, or Apple_Terminal
   - `ITERM_SESSION_ID` environment variable is set
   - A Kitty session file exists at `MEMORY/STATE/kitty-sessions/{session_id}.json`
3. If the session is main, returns `continue` to allow the voice curl
4. If the session is a subagent, returns `block` with a descriptive reason

```typescript
function isMainSession(sessionId: string, deps: VoiceGateDeps): boolean {
  const termProgram = deps.getTermProgram();
  if (termProgram === "iTerm.app" || termProgram === "WarpTerminal" ||
      termProgram === "Alacritty" || termProgram === "Apple_Terminal" ||
      deps.getItermSessionId()) {
    return true;
  }
  // Fall back to checking persisted Kitty session file
  const kittySessionsDir = join(deps.getPaiDir(), "MEMORY", "STATE", "kitty-sessions");
  if (!deps.existsSync(kittySessionsDir)) return true;
  return deps.existsSync(join(kittySessionsDir, `${sessionId}.json`));
}
```

## Examples

### Example 1: Subagent voice curl blocked

> A subagent spawned to handle a parallel task attempts to run `curl localhost:8888/notify -d "Task complete"`. VoiceGate detects the session lacks main terminal environment variables and no Kitty session file exists. The command is blocked with: "Voice notifications are only sent from the main session. Subagent voice curls are suppressed."

### Example 2: Main session voice curl allowed

> The main iTerm session runs `curl localhost:8888/notify -d "Build finished"`. VoiceGate detects `TERM_PROGRAM=iTerm.app` and returns `continue`, allowing the notification to proceed.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `fs` | adapter | Provides `fileExists` for checking Kitty session files |
| `result` | core | Provides `ok` and `Result` type for error handling |
