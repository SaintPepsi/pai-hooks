# UpdateCounts

## Overview

UpdateCounts is a **SessionEnd** hook that spawns a background process to refresh system counters for the PAI dashboard. It fires the `UpdateCounts.ts` handler as a detached process so that count updates capture everything that happened during the session without delaying session shutdown.

The counters are written to `MEMORY/STATE/counts.json` (gitignored), keeping operational data separate from configuration in `settings.json`.

## Event

`SessionEnd` — fires when a Claude Code session ends, spawning a background process to update hook, file, and signal counters.

## When It Fires

- Every session end, unconditionally (accepts always returns true)
- The handler runs detached so it continues even after the hook process exits

It does **not** fire when:

- The session is still active (only fires on SessionEnd)
- The hook is removed from settings.json configuration

## What It Does

1. Resolves the handler path at `{hooksDir}/handlers/UpdateCounts.ts`
2. Spawns `bun` with the handler path as a detached background process
3. If the spawn fails, logs the error to stderr
4. Returns `silent` output immediately (does not wait for the background process)

```typescript
// Spawn detached background process
const handlerPath = join(deps.hooksDir, "handlers", "UpdateCounts.ts");
const result = deps.spawnBackground("bun", [handlerPath]);

if (!result.ok) {
  deps.stderr(`[UpdateCounts] Failed to spawn background: ${result.error.message}`);
}

return ok({});
```

## Examples

### Example 1: Normal session end

> A session ends after the user made several file edits and ran tests. UpdateCounts spawns the background handler, which tallies hook invocations, files modified, and signals emitted during the session, then writes the updated totals to `MEMORY/STATE/counts.json`. The session closes immediately without waiting for the count update.

### Example 2: Spawn failure

> The `bun` binary is not found or the handler file is missing. The hook logs `[UpdateCounts] Failed to spawn background: ...` to stderr and returns silent. The session ends normally; counts will be stale until the next successful run.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `process` | adapter | Provides `spawnBackground` for detached process spawning |
| `result` | core | Provides `ok` and `Result` type for error handling |
| `@anthropic-ai/claude-agent-sdk` | SDK | `SyncHookJSONOutput` return type — silent no-op via `ok({})` post-SDK-refactor (1I), replaces legacy `SilentOutput` |
| `UpdateCounts.ts` | external handler | Background script that reads session data and writes `counts.json` |
