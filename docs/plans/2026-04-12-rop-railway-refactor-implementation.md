# ROP Railway Refactor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure `lib/spawn-agent.ts` and `runners/agent-runner.ts` for clarity, single responsibility, and proper Result railway composition.

**Architecture:** Extract lock management and session state into focused modules. Add `tap`/`tapError` combinators. Refactor both functions to compose with `andThen`/`tap` instead of imperative if/else on Results. `runAgent` returns `Result` instead of `void`.

**Tech Stack:** TypeScript, Bun test runner, `core/result.ts` combinators, `core/error.ts` factory functions.

---

### Task 1: Add `tap` and `tapError` combinators to `core/result.ts`

**Files:**
- Modify: `core/result.ts:34-52` (Combinators section)
- Modify: `core/index.ts:55-70` (barrel export)

**Step 1: Write the failing tests**

Add to a new test file `core/result-combinators.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { err, ok, tap, tapError } from "@hooks/core/result";

describe("tap", () => {
  test("calls fn with value on Ok and returns original Result", () => {
    const seen: number[] = [];
    const result = tap(ok(42), (v) => { seen.push(v); });
    expect(result).toEqual(ok(42));
    expect(seen).toEqual([42]);
  });

  test("does not call fn on Err", () => {
    let called = false;
    const result = tap(err("boom"), () => { called = true; });
    expect(result).toEqual(err("boom"));
    expect(called).toBe(false);
  });
});

describe("tapError", () => {
  test("calls fn with error on Err and returns original Result", () => {
    const seen: string[] = [];
    const result = tapError(err("boom"), (e) => { seen.push(e); });
    expect(result).toEqual(err("boom"));
    expect(seen).toEqual(["boom"]);
  });

  test("does not call fn on Ok", () => {
    let called = false;
    const result = tapError(ok(42), () => { called = true; });
    expect(result).toEqual(ok(42));
    expect(called).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test core/result-combinators.test.ts`
Expected: FAIL — `tap` and `tapError` not exported

**Step 3: Implement the combinators**

Add after `mapError` in `core/result.ts` (around line 52):

```typescript
/** Run a side-effect on Ok without altering the Result. */
export function tap<T, E>(result: Result<T, E>, fn: (value: T) => void): Result<T, E> {
  if (result.ok) fn(result.value);
  return result;
}

/** Run a side-effect on Err without altering the Result. */
export function tapError<T, E>(result: Result<T, E>, fn: (error: E) => void): Result<T, E> {
  if (!result.ok) fn(result.error);
  return result;
}
```

Add exports to `core/index.ts` barrel (in the Result section):

```typescript
  tap,
  tapError,
```

**Step 4: Run tests to verify they pass**

Run: `bun test core/result-combinators.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add core/result.ts core/result-combinators.test.ts core/index.ts
git commit -m "feat(result): add tap and tapError combinators for side-effects on railway"
```

**Note on coding standards hook:** `core/result.ts` contains `tryCatch`/`tryCatchAsync` which the coding standards hook flags as "try-catch flow control." These are the intentional bridge from throwing code to Result — they ARE the adapter boundary. If the hook blocks the edit, move `tryCatch`/`tryCatchAsync` to `core/adapters/try-catch.ts` and re-export from `core/result.ts`.

---

### Task 2: Create `lib/lock.ts` — lock file lifecycle

**Files:**
- Create: `lib/lock.ts`
- Create: `lib/lock.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, expect, test } from "bun:test";
import { ErrorCode, ResultError } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import { acquireLock, type LockDeps, releaseLock } from "@hooks/lib/lock";

function makeLockDeps(overrides: Partial<LockDeps> = {}): LockDeps {
  const files = new Map<string, string>();
  return {
    fileExists: (p) => files.has(p),
    readFile: (p) => {
      const c = files.get(p);
      return c !== undefined ? ok(c) : err(new ResultError(ErrorCode.FileNotFound, `Not found: ${p}`));
    },
    writeFile: (p, c) => { files.set(p, c); return ok(undefined); },
    removeFile: (p) => { files.delete(p); return ok(undefined); },
    _files: files,
    ...overrides,
  } as LockDeps & { _files: Map<string, string> };
}

describe("acquireLock", () => {
  test("writes lock and returns 'acquired' when no lock exists", () => {
    const deps = makeLockDeps();
    const result = acquireLock("/tmp/test.lock", "TestHook", "unit test", deps);
    expect(result.ok).toBe(true);
    expect(result.value).toBe("acquired");
  });

  test("returns 'skipped' when fresh lock exists", () => {
    const freshLock = JSON.stringify({ ts: new Date().toISOString(), source: "Other", reason: "running" });
    const deps = makeLockDeps({ fileExists: () => true, readFile: () => ok(freshLock) });
    const result = acquireLock("/tmp/test.lock", "TestHook", "unit test", deps);
    expect(result.ok).toBe(true);
    expect(result.value).toBe("skipped");
  });

  test("replaces stale lock and returns 'acquired'", () => {
    const staleTs = new Date(Date.now() - 7 * 60 * 1000).toISOString();
    const staleLock = JSON.stringify({ ts: staleTs, source: "Old", reason: "stale" });
    const files = new Map([[ "/tmp/test.lock", staleLock ]]);
    const deps = makeLockDeps({
      fileExists: (p) => files.has(p),
      readFile: (p) => { const c = files.get(p); return c ? ok(c) : err(new ResultError(ErrorCode.FileNotFound, p)); },
      writeFile: (p, c) => { files.set(p, c); return ok(undefined); },
      removeFile: (p) => { files.delete(p); return ok(undefined); },
    });
    const result = acquireLock("/tmp/test.lock", "TestHook", "unit test", deps);
    expect(result.ok).toBe(true);
    expect(result.value).toBe("acquired");
  });

  test("returns err when writeFile fails", () => {
    const deps = makeLockDeps({
      writeFile: () => err(new ResultError(ErrorCode.FileWriteFailed, "disk full")),
    });
    const result = acquireLock("/tmp/test.lock", "TestHook", "unit test", deps);
    expect(result.ok).toBe(false);
  });

  test("handles corrupted lock JSON gracefully (treats as stale)", () => {
    const deps = makeLockDeps({
      fileExists: () => true,
      readFile: () => ok("not-valid-json!!!"),
    });
    const result = acquireLock("/tmp/test.lock", "TestHook", "unit test", deps);
    expect(result.ok).toBe(true);
    expect(result.value).toBe("acquired");
  });

  test("lock file contains source, reason, and ts", () => {
    const files = new Map<string, string>();
    const deps = makeLockDeps({
      writeFile: (p, c) => { files.set(p, c); return ok(undefined); },
    });
    acquireLock("/tmp/test.lock", "TestHook", "unit test", deps);
    const lockData = JSON.parse(files.get("/tmp/test.lock")!);
    expect(lockData.source).toBe("TestHook");
    expect(lockData.reason).toBe("unit test");
    expect(lockData.ts).toBeDefined();
  });
});

describe("releaseLock", () => {
  test("removes lock file and returns ok", () => {
    const removed: string[] = [];
    const deps = makeLockDeps({ removeFile: (p) => { removed.push(p); return ok(undefined); } });
    const result = releaseLock("/tmp/test.lock", deps);
    expect(result.ok).toBe(true);
    expect(removed).toContain("/tmp/test.lock");
  });

  test("returns err when removeFile fails", () => {
    const deps = makeLockDeps({
      removeFile: () => err(new ResultError(ErrorCode.FileWriteFailed, "permission denied")),
    });
    const result = releaseLock("/tmp/test.lock", deps);
    expect(result.ok).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test lib/lock.test.ts`
Expected: FAIL — module not found

**Step 3: Implement `lib/lock.ts`**

```typescript
/**
 * Lock file lifecycle — acquire, check staleness, release.
 *
 * Single responsibility: manage lock files for background agent spawning.
 * All operations return Result. JSON.parse is wrapped in tryCatch.
 */

import type { ResultError } from "@hooks/core/error";
import { ok, type Result, tryCatch } from "@hooks/core/result";

// ─── Constants ──────────────────────────────────────────────────────────────

const LOCK_STALE_MS = 6 * 60 * 1000; // 6 minutes

// ─── Types ──────────────────────────────────────────────────────────────────

interface LockData {
  ts: string;
  source: string;
  reason: string;
}

export interface LockDeps {
  fileExists: (path: string) => boolean;
  readFile: (path: string) => Result<string, ResultError>;
  writeFile: (path: string, content: string) => Result<void, ResultError>;
  removeFile: (path: string) => Result<void, ResultError>;
}

// ─── Internal ───────────────────────────────────────────────────────────────

function parseLockData(raw: string): Result<LockData, ResultError> {
  return tryCatch(
    () => JSON.parse(raw) as LockData,
    (e) => new ResultError("STATE_CORRUPTED" as any, `Corrupted lock file: ${e}`, e),
  );
}

function isStale(lock: LockData): boolean {
  const lockAge = Date.now() - new Date(lock.ts).getTime();
  return lockAge > LOCK_STALE_MS;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function acquireLock(
  path: string,
  source: string,
  reason: string,
  deps: LockDeps,
): Result<"acquired" | "skipped", ResultError> {
  // Check existing lock
  if (deps.fileExists(path)) {
    const readResult = deps.readFile(path);

    if (readResult.ok) {
      const parseResult = parseLockData(readResult.value);

      // Fresh valid lock — skip
      if (parseResult.ok && !isStale(parseResult.value)) {
        return ok("skipped");
      }

      // Stale or corrupted — remove and continue to acquire
      deps.removeFile(path);
    }
    // readFile failed — lock file exists but unreadable, remove and continue
    else {
      deps.removeFile(path);
    }
  }

  // Write new lock
  const lockData: LockData = { ts: new Date().toISOString(), source, reason };
  const writeResult = deps.writeFile(path, JSON.stringify(lockData));
  if (!writeResult.ok) return writeResult;

  return ok("acquired");
}

export function releaseLock(
  path: string,
  deps: Pick<LockDeps, "removeFile">,
): Result<void, ResultError> {
  return deps.removeFile(path);
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test lib/lock.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/lock.ts lib/lock.test.ts
git commit -m "feat(lock): extract lock lifecycle module from spawn-agent"
```

---

### Task 3: Create `lib/session-state.ts` — session ID persistence

**Files:**
- Create: `lib/session-state.ts`
- Create: `lib/session-state.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, expect, test } from "bun:test";
import { ErrorCode, ResultError } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import { loadSessionId, persistSessionId, type SessionDeps } from "@hooks/lib/session-state";

function makeSessionDeps(overrides: Partial<SessionDeps> = {}): SessionDeps {
  const files = new Map<string, string>();
  return {
    readFile: (p) => {
      const c = files.get(p);
      return c !== undefined ? ok(c) : err(new ResultError(ErrorCode.FileNotFound, p));
    },
    writeFile: (p, c) => { files.set(p, c); return ok(undefined); },
    _files: files,
    ...overrides,
  } as SessionDeps & { _files: Map<string, string> };
}

describe("loadSessionId", () => {
  test("returns session ID from file when it exists", () => {
    const deps = makeSessionDeps({ readFile: () => ok("session-123\n") });
    const result = loadSessionId("/tmp/test.session", deps);
    expect(result.ok).toBe(true);
    expect(result.value).toBe("session-123");
  });

  test("returns empty string when file does not exist", () => {
    const deps = makeSessionDeps();
    const result = loadSessionId("/tmp/missing.session", deps);
    expect(result.ok).toBe(true);
    expect(result.value).toBe("");
  });

  test("returns empty string when path is undefined", () => {
    const deps = makeSessionDeps();
    const result = loadSessionId(undefined, deps);
    expect(result.ok).toBe(true);
    expect(result.value).toBe("");
  });
});

describe("persistSessionId", () => {
  test("writes session ID to file", () => {
    const written: Array<{ path: string; content: string }> = [];
    const deps = makeSessionDeps({
      writeFile: (p, c) => { written.push({ path: p, content: c }); return ok(undefined); },
    });
    const result = persistSessionId("/tmp/test.session", "session-456", deps);
    expect(result.ok).toBe(true);
    expect(written).toEqual([{ path: "/tmp/test.session", content: "session-456" }]);
  });

  test("returns ok without writing when path is undefined", () => {
    let writeCalled = false;
    const deps = makeSessionDeps({ writeFile: () => { writeCalled = true; return ok(undefined); } });
    const result = persistSessionId(undefined, "session-456", deps);
    expect(result.ok).toBe(true);
    expect(writeCalled).toBe(false);
  });

  test("returns ok without writing when sessionId is empty", () => {
    let writeCalled = false;
    const deps = makeSessionDeps({ writeFile: () => { writeCalled = true; return ok(undefined); } });
    const result = persistSessionId("/tmp/test.session", "", deps);
    expect(result.ok).toBe(true);
    expect(writeCalled).toBe(false);
  });

  test("returns err when writeFile fails", () => {
    const deps = makeSessionDeps({
      writeFile: () => err(new ResultError(ErrorCode.FileWriteFailed, "disk full")),
    });
    const result = persistSessionId("/tmp/test.session", "session-789", deps);
    expect(result.ok).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test lib/session-state.test.ts`
Expected: FAIL — module not found

**Step 3: Implement `lib/session-state.ts`**

```typescript
/**
 * Session state — load and persist session IDs for agent resumption.
 *
 * Single responsibility: session ID file I/O.
 * Missing file is valid state (empty string = fresh session).
 */

import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SessionDeps {
  readFile: (path: string) => Result<string, ResultError>;
  writeFile: (path: string, content: string) => Result<void, ResultError>;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function loadSessionId(
  path: string | undefined,
  deps: Pick<SessionDeps, "readFile">,
): Result<string, ResultError> {
  if (!path) return ok("");

  const result = deps.readFile(path);
  if (!result.ok) return ok(""); // missing file = no previous session
  return ok(result.value.trim());
}

export function persistSessionId(
  path: string | undefined,
  sessionId: string,
  deps: Pick<SessionDeps, "writeFile">,
): Result<void, ResultError> {
  if (!path || !sessionId) return ok(undefined);
  return deps.writeFile(path, sessionId);
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test lib/session-state.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/session-state.ts lib/session-state.test.ts
git commit -m "feat(session-state): extract session ID persistence from agent-runner"
```

---

### Task 4: Refactor `lib/spawn-agent.ts` — railway composition with lock module

**Files:**
- Modify: `lib/spawn-agent.ts` (full rewrite of function body)
- Modify: `lib/spawn-agent.test.ts` (update for new return type)

**Step 1: Rewrite `lib/spawn-agent.ts`**

The function becomes a thin orchestrator. Lock logic moves to `lib/lock.ts`. Every Result is on the railway.

```typescript
/**
 * Shared spawnAgent() — background Claude agent spawning with lock/log/traceability.
 *
 * PRINCIPLE: Least privileged agent to perform task.
 * Callers should scope each agent to the minimum capabilities required:
 * narrow MCP tools (e.g. read/write for a single file), no hooks unless
 * needed, no extra permissions. More surface = more cost, more drift.
 *
 * Orchestrates: acquireLock → logEvent → spawnBackground → tapError(releaseLock)
 * Returns Result<"spawned" | "skipped", ResultError> — never throws.
 */

import { join } from "node:path";
import { appendFile, fileExists, readFile, removeFile, writeFile } from "@hooks/core/adapters/fs";
import { spawnBackground } from "@hooks/core/adapters/process";
import type { ResultError } from "@hooks/core/error";
import { andThen, ok, type Result, tap, tapError } from "@hooks/core/result";
import { acquireLock, type LockDeps, releaseLock } from "@hooks/lib/lock";
import { defaultStderr } from "@hooks/lib/paths";

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "opus";
const DEFAULT_MAX_TURNS = 5;
const DEFAULT_TIMEOUT = 300_000; // 5 minutes

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SpawnAgentConfig {
  prompt: string;
  lockPath: string;
  model?: string;
  maxTurns?: number;
  timeout?: number;
  cwd?: string;
  logPath: string;
  source: string;
  reason: string;
  claudeArgs?: string[];
  sessionStatePath?: string;
}

export interface SpawnAgentDeps {
  lock: LockDeps;
  appendFile: (path: string, content: string) => Result<void, ResultError>;
  spawnBackground: (
    cmd: string,
    args: string[],
    opts?: { cwd?: string },
  ) => Result<void, ResultError>;
  runnerPath: string;
  stderr: (msg: string) => void;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

const defaultDeps: SpawnAgentDeps = {
  lock: { fileExists, readFile, writeFile, removeFile },
  appendFile,
  spawnBackground,
  runnerPath: join(import.meta.dir, "../runners/agent-runner.ts"),
  stderr: defaultStderr,
};

// ─── Internal ───────────────────────────────────────────────────────────────

function logSpawnEvent(
  logPath: string,
  source: string,
  reason: string,
  deps: Pick<SpawnAgentDeps, "appendFile">,
): Result<void, ResultError> {
  const entry = JSON.stringify({
    event: "spawned",
    ts: new Date().toISOString(),
    source,
    reason,
  });
  return deps.appendFile(logPath, entry + "\n");
}

function buildRunnerConfig(config: SpawnAgentConfig) {
  return {
    prompt: config.prompt,
    model: config.model ?? DEFAULT_MODEL,
    maxTurns: config.maxTurns ?? DEFAULT_MAX_TURNS,
    timeout: config.timeout ?? DEFAULT_TIMEOUT,
    lockPath: config.lockPath,
    logPath: config.logPath,
    source: config.source,
    cwd: config.cwd,
    claudeArgs: config.claudeArgs,
    sessionStatePath: config.sessionStatePath,
  };
}

// ─── Core ───────────────────────────────────────────────────────────────────

export function spawnAgent(
  config: SpawnAgentConfig,
  deps: SpawnAgentDeps = defaultDeps,
): Result<"spawned" | "skipped", ResultError> {
  const { lockPath, logPath, source, reason } = config;

  // 1. Acquire lock (returns "acquired" or "skipped")
  const lockResult = acquireLock(lockPath, source, reason, deps.lock);
  if (!lockResult.ok) {
    deps.stderr(`[spawnAgent] Failed to acquire lock: ${lockResult.error.message}`);
    return lockResult;
  }
  if (lockResult.value === "skipped") {
    deps.stderr(`[spawnAgent] Lock file fresh, skipping spawn (source: ${source})`);
    return ok("skipped");
  }

  // 2. Log → spawn, with cleanup on failure
  const pipeline = andThen(
    logSpawnEvent(logPath, source, reason, deps),
    () => {
      const runnerConfig = buildRunnerConfig(config);
      const spawnOpts = config.cwd ? { cwd: config.cwd } : undefined;
      return deps.spawnBackground(
        "bun",
        [deps.runnerPath, JSON.stringify(runnerConfig)],
        spawnOpts,
      );
    },
  );

  // Side-effects: log outcome
  return tap(
    tapError(pipeline, (e) => {
      deps.stderr(`[spawnAgent] Failed to spawn: ${e.message}`);
      releaseLock(lockPath, deps.lock);
    }),
    () => deps.stderr(`[spawnAgent] Spawned background agent (source: ${source})`),
  ).ok
    ? ok("spawned")
    : (pipeline as Result<"spawned", ResultError>);
}
```

**Step 2: Update tests in `lib/spawn-agent.test.ts`**

Key changes:
- `SpawnAgentDeps` shape changed: `lock` sub-object replaces `fileExists`/`readFile`/`writeFile`/`removeFile`
- Return value is `"spawned" | "skipped"` instead of `void`
- Update `makeFakeDeps` to match new shape
- All existing test scenarios remain, behavioral parity

The `makeFakeDeps` helper needs to wrap file ops under `lock`:

```typescript
function makeFakeDeps(overrides: Partial<SpawnAgentDeps> = {}): SpawnAgentDeps {
  const files = new Map<string, string>();
  const stderrMessages: string[] = [];

  const lock: LockDeps = {
    fileExists: (path) => files.has(path),
    readFile: (path) => {
      const content = files.get(path);
      return content !== undefined ? ok(content) : err(new ResultError(ErrorCode.FileNotFound, `Not found: ${path}`));
    },
    writeFile: (path, content) => { files.set(path, content); return ok(undefined); },
    removeFile: (path) => { files.delete(path); return ok(undefined); },
  };

  return {
    lock,
    appendFile: (path, content) => {
      const existing = files.get(path) ?? "";
      files.set(path, existing + content);
      return ok(undefined);
    },
    spawnBackground: () => ok(undefined),
    runnerPath: "/fake/runner.ts",
    stderr: (msg) => stderrMessages.push(msg),
    _files: files,
    _stderrMessages: stderrMessages,
    ...overrides,
  } as SpawnAgentDeps & { _files: Map<string, string>; _stderrMessages: string[] };
}
```

Update assertions that check `result.ok` to also verify `result.value` is `"spawned"` or `"skipped"` where appropriate.

**Step 3: Update callers that construct `SpawnAgentDeps`**

Check `run-article-writer.ts`, `run-learning-agent.ts`, `run-hardening.ts` — these pass custom deps with `fileExists`/`readFile`/etc. They need to nest those under `lock`. Also update their test files.

**Step 4: Run tests**

Run: `bun test lib/spawn-agent.test.ts && bun test hooks/WorkLifecycle/ArticleWriter/ && bun test hooks/LearningFeedback/LearningActioner/ && bun test hooks/SecurityValidator/`
Expected: PASS

**Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add lib/spawn-agent.ts lib/spawn-agent.test.ts hooks/WorkLifecycle/ArticleWriter/ hooks/LearningFeedback/LearningActioner/ hooks/SecurityValidator/
git commit -m "refactor(spawn-agent): compose with lock module and Result railway"
```

---

### Task 5: Refactor `runners/agent-runner.ts` — Result return, wrapped JSON.parse, session module

**Files:**
- Modify: `runners/agent-runner.ts` (return Result, use session-state, wrap JSON.parse)
- Modify: `runners/agent-runner.test.ts` (update for Result return type)

**Step 1: Rewrite `runners/agent-runner.ts`**

Key changes:
- `runAgent` returns `Result<RunResult, ResultError>` instead of `void`
- `JSON.parse(stdout)` wrapped in `tryCatch`
- Session load/persist via `lib/session-state.ts`
- Lock release via `lib/lock.ts`
- `logEvent` returns `Result` instead of `void`
- BUN_TEST guard returns `err()` instead of throwing

```typescript
/**
 * Agent Runner — Generic runner spawned as a detached background process.
 *
 * Receives config as a JSON CLI arg, runs claude synchronously, and
 * deterministically cleans up lock/log files regardless of exit status.
 *
 * Returns Result<RunResult, ResultError>. Lock release always runs
 * regardless of which track the pipeline is on.
 */

import { appendFile, readFile, removeFile, writeFile } from "@hooks/core/adapters/fs";
import { spawnSyncSafe } from "@hooks/core/adapters/process";
import { type ResultError, jsonParseFailed, securityBlock } from "@hooks/core/error";
import { andThen, err, ok, type Result, tap, tryCatch } from "@hooks/core/result";
import { releaseLock } from "@hooks/lib/lock";
import { loadSessionId, persistSessionId } from "@hooks/lib/session-state";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RunResult {
  sessionId: string;
  exitCode: number;
  resumed: boolean;
}

export interface RunnerConfig {
  prompt: string;
  model: string;
  maxTurns: number;
  timeout: number;
  lockPath: string;
  logPath: string;
  source: string;
  cwd?: string;
  claudeArgs?: string[];
  sessionStatePath?: string;
}

export interface AgentRunnerDeps {
  appendFile: (path: string, content: string) => Result<void, ResultError>;
  readFile: (path: string) => Result<string, ResultError>;
  removeFile: (path: string) => Result<void, ResultError>;
  writeFile: (path: string, content: string) => Result<void, ResultError>;
  spawnSyncSafe: typeof spawnSyncSafe;
  stderr: (msg: string) => void;
  env: Record<string, string | undefined>;
}

const defaultDeps: AgentRunnerDeps = {
  appendFile,
  readFile,
  removeFile,
  writeFile,
  spawnSyncSafe,
  stderr: (msg) => process.stderr.write(`${msg}\n`),
  env: process.env as Record<string, string | undefined>,
};

// ─── Internal ─────────────────────────────────────────────────────────────

function logEvent(
  logPath: string,
  data: Record<string, string | number>,
  deps: Pick<AgentRunnerDeps, "appendFile">,
): Result<void, ResultError> {
  const entry = { ts: new Date().toISOString(), ...data };
  return deps.appendFile(logPath, `${JSON.stringify(entry)}\n`);
}

function parseClaudeOutput(stdout: string): Result<string, ResultError> {
  if (!stdout) return ok("");
  return andThen(
    tryCatch(
      () => JSON.parse(stdout) as { session_id?: string },
      (e) => jsonParseFailed(stdout, e),
    ),
    (output) => ok(output.session_id ?? ""),
  );
}

function executeClaude(
  config: RunnerConfig,
  previousSessionId: string,
  deps: Pick<AgentRunnerDeps, "spawnSyncSafe" | "stderr">,
): Result<{ stdout: string; stderr: string; exitCode: number }, ResultError> {
  const baseArgs = [
    "--max-turns", String(config.maxTurns),
    "--model", config.model,
    "--output-format", "json",
    ...(config.claudeArgs ?? []),
  ];
  const spawnOpts = { cwd: config.cwd, timeout: config.timeout, stdio: "pipe" as const };

  // Try resume if we have a previous session
  let result = previousSessionId
    ? deps.spawnSyncSafe("claude", ["--resume", previousSessionId, "-p", config.prompt, ...baseArgs], spawnOpts)
    : deps.spawnSyncSafe("claude", ["-p", config.prompt, ...baseArgs], spawnOpts);

  // Fallback to fresh session if resume failed
  if (!result.ok && previousSessionId) {
    deps.stderr("[agent-runner] Resume failed, falling back to fresh session");
    result = deps.spawnSyncSafe("claude", ["-p", config.prompt, ...baseArgs], spawnOpts);
  }

  return tap(result, (v) => {
    if (v.stderr) deps.stderr(`[agent-runner] claude stderr: ${v.stderr}`);
  });
}

// ─── Runner ────────────────────────────────────────────────────────────────

export function runAgent(
  config: RunnerConfig,
  dryRun: boolean,
  deps: AgentRunnerDeps = defaultDeps,
): Result<RunResult, ResultError> {
  // Hard safety guard
  if (deps.env.BUN_TEST && !dryRun) {
    return err(securityBlock(
      "BUN_TEST is set but --dry-run was not passed. Refusing to spawn claude in test environment.",
    ));
  }

  if (dryRun) {
    logEvent(config.logPath, { event: "dry-run", source: config.source, model: config.model }, deps);
    releaseLock(config.lockPath, { removeFile: deps.removeFile });
    return ok({ sessionId: "", exitCode: 0, resumed: false });
  }

  // Load previous session
  const sessionLoad = loadSessionId(config.sessionStatePath, deps);
  const previousSessionId = sessionLoad.ok ? sessionLoad.value : "";

  // Execute claude
  const claudeResult = executeClaude(config, previousSessionId, deps);

  // Parse output → persist session → log → release lock
  let runResult: Result<RunResult, ResultError>;

  if (claudeResult.ok) {
    const parseResult = parseClaudeOutput(claudeResult.value.stdout);
    const sessionId = parseResult.ok ? parseResult.value : "";

    persistSessionId(config.sessionStatePath, sessionId, deps);
    logEvent(config.logPath, {
      event: "completed",
      source: config.source,
      exitCode: claudeResult.value.exitCode,
      session: sessionId,
      resumed: previousSessionId ? "true" : "false",
    }, deps);

    runResult = ok({ sessionId, exitCode: claudeResult.value.exitCode, resumed: !!previousSessionId });
  } else {
    logEvent(config.logPath, { event: "failed", source: config.source, error: claudeResult.error.message }, deps);
    runResult = err(claudeResult.error);
  }

  // Always release lock
  releaseLock(config.lockPath, { removeFile: deps.removeFile });

  return runResult;
}

// ─── Script entry point ────────────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const configArg = args.find((a) => !a.startsWith("--"));

  if (!configArg) {
    process.stderr.write("[agent-runner] Missing JSON config argument\n");
    process.exit(1);
  }

  const config = JSON.parse(configArg) as RunnerConfig;
  runAgent(config, dryRun);
}
```

**Step 2: Update tests in `runners/agent-runner.test.ts`**

Key changes:
- BUN_TEST guard: change from `expect(() => ...).toThrow()` to `expect(result.ok).toBe(false)` with error code check
- All tests that called `runAgent` and checked void now check `result.ok` and `result.value`
- Add new test: "returns RunResult with sessionId, exitCode, resumed on success"
- Add new test: "returns err with JsonParseFailed when claude output is malformed"
- Behavioral parity for all existing scenarios

**Step 3: Run tests**

Run: `bun test runners/agent-runner.test.ts`
Expected: PASS

**Step 4: Run full suite + type check**

Run: `bun test && npx tsc --noEmit`
Expected: All pass, no type errors

**Step 5: Commit**

```bash
git add runners/agent-runner.ts runners/agent-runner.test.ts
git commit -m "refactor(agent-runner): return Result, wrap JSON.parse, use session-state module"
```

---

### Task 6: Final verification and cleanup

**Files:**
- Review: all modified files

**Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Verify railway compliance**

Manually trace both refactored functions and confirm:
- No dropped Results (every Result return value is used)
- No naked `JSON.parse` (all wrapped in `tryCatch`)
- No `void` returns from `runAgent` (returns `Result<RunResult, ResultError>`)
- Lock lifecycle fully in `lib/lock.ts`
- Session lifecycle fully in `lib/session-state.ts`

**Step 4: Commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: final cleanup after ROP railway refactor"
```
