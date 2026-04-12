# MessageQueueServer

## Overview

MessageQueueServer is an **async SessionStart** hook that spawns a detached Bun HTTP server (`scripts/mq-server.ts`) to accept messages from the Koord daemon. The server listens on an auto-assigned port and writes it to `/tmp/pai-mq/{session_id}/port`, enabling the daemon to push realtime messages into the session.

After spawning the server, the hook returns context instructing the agent to start the message queue watcher script, which creates a persistent message relay loop in combination with the MessageQueueRelay hook.

## Event

`SessionStart` — fires when a Claude Code session begins, spawning the message queue server if a Koord daemon URL is configured.

## When It Fires

- A valid `session_id` is present in the hook input
- A Koord daemon URL is configured via `KOORD_DAEMON_URL` env var or `hookConfig.koordDaemon.url` in `settings.json`
- No server is already running for this session (checked via port file existence)

It does **not** fire when:

- No `session_id` is provided in the input
- No daemon URL is configured (not a Koord session)
- A port file already exists at `/tmp/pai-mq/{session_id}/port` (server already running)
- The server spawn fails (returns silent, non-blocking)

## What It Does

1. Validates `session_id` exists in the hook input
2. Resolves daemon URL from `KOORD_DAEMON_URL` env var, falling back to `hookConfig.koordDaemon.url` in settings.json
3. Checks if a server is already running by testing for the port file
4. Spawns a detached `bun run scripts/mq-server.ts --session {session_id}` process
5. Waits 300ms for the server to write its port file
6. Returns context with instructions for the agent to start the mq-watcher script

```typescript
// Spawn the detached mq-server process
const scriptPath = deps.getScriptPath();
const result = deps.spawnDetached("bun", ["run", scriptPath, "--session", sessionId]);

// Return context instructing agent to start the watcher
return ok({
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: "## Message Queue Active\n...",
  },
});
```

## Examples

### Example 1: Daemon-connected session start

> A Claude Code session starts with `KOORD_DAEMON_URL=http://localhost:3000` set. MessageQueueServer spawns the HTTP server on an auto-assigned port, writes the port number to `/tmp/pai-mq/{session_id}/port`, and returns context telling the agent to run `bun scripts/mq-watcher.ts --session {session_id}` to begin listening for messages.

### Example 2: Non-Koord session

> A regular Claude Code session starts without any daemon URL configured. MessageQueueServer detects the missing URL and returns `silent`, allowing the session to proceed without any message queue infrastructure.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `result` | core | `ok()` for Result wrapping |
| `KoordDaemon/shared` | shared | `readKoordConfig`, `defaultReadFileOrNull`, `getQueueDir` |
| `paths` | lib | Path resolution utilities |
| `process` | adapter | Environment variable access |
