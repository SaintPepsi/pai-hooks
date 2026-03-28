# SessionIdRegister

## Overview

SessionIdRegister is an **async SessionStart** hook that registers a thread agent's `session_id` with the Koord daemon. When the daemon spawns a Claude Code thread agent, it sets `KOORD_THREAD_ID` and `KOORD_DAEMON_URL` as environment variables. This hook POSTs the session-to-thread mapping back to the daemon so messages can include the correct session ID from the first message onward.

The hook always returns `SilentOutput` and fails silently on errors, ensuring it never blocks session startup.

## Event

`SessionStart` — fires when a Claude Code session begins, registering the session ID with the Koord daemon if this is a daemon-spawned thread agent.

## When It Fires

- A valid `session_id` is present in the hook input
- `KOORD_THREAD_ID` env var is set (indicates this session was spawned by the daemon)
- A daemon URL is available via `KOORD_DAEMON_URL` env var or `hookConfig.koordDaemon.url` in settings.json

It does **not** fire when:

- No `session_id` is provided in the input
- `KOORD_THREAD_ID` env var is missing (not a daemon-spawned thread agent)
- No daemon URL is configured in either env var or settings.json

## What It Does

1. Validates `session_id` exists in the hook input
2. Reads `KOORD_THREAD_ID` from the environment; exits silently if missing
3. Resolves daemon URL from `KOORD_DAEMON_URL` env var, falling back to settings.json
4. POSTs `{ sessionId, threadId }` to `{daemonUrl}/register-session` with a 3-second timeout
5. Logs success or failure to stderr (non-blocking on failure)

```typescript
const url = `${baseUrl}/register-session`;
const body = JSON.stringify({ sessionId, threadId });

const result = await deps.safeFetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
  timeout: 3000,
});
```

## Examples

### Example 1: Daemon-spawned thread agent

> The Koord daemon spawns a new Claude Code thread agent with `KOORD_THREAD_ID=1234567890123456789` and `KOORD_DAEMON_URL=http://localhost:3000`. On session start, SessionIdRegister POSTs `{ sessionId: "abc123...", threadId: "1234567890123456789" }` to `http://localhost:3000/register-session`, allowing the daemon to route messages to this session.

### Example 2: Regular session (no thread ID)

> A user starts a Claude Code session normally without any Koord environment variables. SessionIdRegister detects the missing `KOORD_THREAD_ID` and exits silently without making any network calls.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `result` | core | `ok()` for Result wrapping |
| `fetch` | adapter | `safeFetch` for HTTP POST with timeout |
| `KoordDaemon/shared` | shared | `readKoordConfig`, `defaultReadFileOrNull` |
| `paths` | lib | Path resolution utilities |
