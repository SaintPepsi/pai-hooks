# KoordDaemon Hooks

Lifecycle hooks for the Koord agent-to-agent communication daemon. These hooks
notify the daemon of agent spawns, completions, and session registrations.

Ported from raw JS hooks in `/Users/hogers/Projects/koord/.claude/hooks/`.

## Configuration

Configure in `~/.claude/settings.json` under `hookConfig.koordDaemon`:

```json
{
  "hookConfig": {
    "koordDaemon": {
      "url": "http://localhost:9999",
      "prepromptPath": "/absolute/path/to/worker.md"
    }
  }
}
```

- `url` — Daemon base URL. Env var `KOORD_DAEMON_URL` takes precedence.
- `prepromptPath` — Absolute path to the worker preprompt template. Falls back to `{cwd}/src/prompts/worker.md`.

## Hooks

| Hook | Event | Purpose |
|------|-------|---------|
| SessionIdRegister | SessionStart | Registers session_id with daemon for thread agents |
| MessageQueueServer | SessionStart | Spawns detached MQ HTTP server for daemon message delivery |
| AgentPrepromptInjector | PreToolUse | Injects worker preprompt into background agent prompts |
| AgentSpawnTracker | PostToolUse | Notifies daemon when a background agent is spawned |
| AgentCompleteTracker | PostToolUse | Notifies daemon when an agent completes |
| MessageQueueRelay | PostToolUse | Relays mq-watcher messages to the agent with respawn directive |

## Shared Module

`shared.ts` contains:
- `KoordDaemonConfig` type and `readKoordConfig()` settings.json reader
- `extractThreadId()`, `extractAgentName()`, `extractTask()` — from tool_input
- `extractThreadIdFromOutput()` — from tool_output only (avoids spawn-time false positives)

## Tests

118 tests across 8 files: `KoordDaemon.test.ts`, `KoordDaemon.parity.test.ts`, `MessageQueue.test.ts`, and per-hook test files for `AgentPrepromptInjector`, `MessageQueueRelay`, `MessageQueueServer`, `AgentSpawnTracker`, and `AgentCompleteTracker`.
