# ROP Railway Refactor — Agent Spawning Pipeline

**Date:** 2026-04-12
**Status:** Approved
**Scope:** `lib/spawn-agent.ts`, `runners/agent-runner.ts`, `core/result.ts`

## Problem

`spawnAgent()` and `runAgent()` declare Result-based contracts but internally derail from the
railway at 13 of 16 operations. Dropped Results, naked `JSON.parse` throws, boolean I/O, and a
`void` return type mean failures are silently swallowed.

### Railway audit

**`spawnAgent()` — 2/8 operations on the railway:**

| Step | Operation | Returns | Handled? |
|------|-----------|---------|----------|
| 1 | `fileExists(lockPath)` | boolean | I/O returning bool, not Result |
| 2 | `readFile(lockPath)` | Result | Error silently swallowed |
| 3 | `isLockStale()` → `JSON.parse` | throws | Naked throw in business logic |
| 4 | `removeFile(lockPath)` | Result | Return value ignored |
| 5 | `writeFile(lockPath, ...)` | Result | Checked, propagated |
| 6 | `appendFile(logPath, ...)` | Result | Return value ignored |
| 7 | `spawnBackground(...)` | Result | Checked, propagated |
| 8 | `removeFile(lockPath)` | Result | Return value ignored |

**`runAgent()` — 1/8 operations on the railway:**

| Step | Operation | Returns | Handled? |
|------|-----------|---------|----------|
| 1 | BUN_TEST check | throw | Deliberate, but off-railway |
| 2 | `removeFile` (dry-run) | Result | Ignored |
| 3 | `readFile(sessionStatePath)` | Result | Error swallowed silently |
| 4 | `spawnSyncSafe("claude")` | Result | Checked |
| 5 | `JSON.parse(stdout)` | throws | Naked throw, malformed JSON = crash |
| 6 | `writeFile(sessionStatePath)` | Result | Ignored |
| 7 | `appendFile` (logEvent) | Result | Ignored |
| 8 | `removeFile(lockPath)` | Result | Ignored |

## Design

### 1. New combinators — `core/result.ts`

- **`tap(result, fn)`** — run side-effect on Ok track, return original Result unchanged
- **`tapError(result, fn)`** — run side-effect on Err track, return original Result unchanged

### 2. Extract `lib/lock.ts`

Single responsibility: lock file lifecycle.

```typescript
acquireLock(path, source, reason, deps): Result<"acquired" | "skipped", ResultError>
releaseLock(path, deps): Result<void, ResultError>
```

- Encapsulates: exists check, stale detection, JSON.parse (wrapped in tryCatch), remove-if-stale, write
- `isLockStale` becomes internal with wrapped JSON.parse

### 3. Extract `lib/session-state.ts`

Single responsibility: session ID persistence.

```typescript
loadSessionId(path | undefined, deps): Result<string, ResultError>
persistSessionId(path | undefined, sessionId, deps): Result<void, ResultError>
```

- Missing file returns `ok("")` (no session is valid state)
- Undefined path returns `ok("")` / `ok(undefined)` (no-op)

### 4. Refactor `lib/spawn-agent.ts`

Thin orchestrator. Return type widens:

```typescript
spawnAgent(config, deps): Result<"spawned" | "skipped", ResultError>
```

Pipeline: `acquireLock → tap(logSpawnEvent) → spawnBackground → tapError(releaseLock)`

### 5. Refactor `runners/agent-runner.ts`

Returns Result instead of void:

```typescript
interface RunResult { sessionId: string; exitCode: number; resumed: boolean }
runAgent(config, dryRun, deps): Result<RunResult, ResultError>
```

Pipeline: `loadSessionId → buildArgs → executeClaude → andThen(parseOutput) → tap(persistSession) → tap(logEvent) → releaseLock`

- `JSON.parse` wrapped in `tryCatch`
- Lock release always runs regardless of track

### 6. What does NOT change

- `core/adapters/process.ts` — untouched
- `SpawnAgentConfig` shape — callers pass the same config
- The 3 hook callers — `spawnAgent()` stays compatible (callers check `.ok`)
- Steering rule `use-agent-runner-not-print-mode` — still valid
- All existing test scenarios — behavioral parity, structural changes only
