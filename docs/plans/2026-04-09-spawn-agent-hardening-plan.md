# Shared Agent Spawning + Settings Hardening Loop — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a shared `spawnAgent()` function in `lib/spawn-agent.ts` and a generic `runners/agent-runner.ts`, then wire SettingsRevert to spawn a hardening agent that auto-updates `patterns.yaml` when bypasses are caught.

**Architecture:** `lib/spawn-agent.ts` provides the hook-facing API (lock check, log, spawn). `runners/agent-runner.ts` is the detached process that calls `claude -p`. SettingsRevert calls `spawnAgent()` after reverting, passing a hardening prompt that targets `patterns.yaml`. A `BUN_TEST` env guard in the runner prevents accidental token burn in tests.

**Tech Stack:** TypeScript, Bun, pai-hooks Result pipeline (`core/result.ts`), fs/process adapters (`core/adapters/`).

**Design doc:** `docs/plans/2026-04-09-spawn-agent-hardening-design.md`

---

### Task 1: `lib/spawn-agent.ts` — Types and `spawnAgent()` function

**Files:**

- Create: `lib/spawn-agent.ts`
- Test: `lib/spawn-agent.test.ts`

**Step 1: Write the failing test**

Create `lib/spawn-agent.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { ok, type Result } from "@hooks/core/result";
import { type ResultError } from "@hooks/core/error";
import {
  spawnAgent,
  type SpawnAgentConfig,
  type SpawnAgentDeps,
} from "@hooks/lib/spawn-agent";

const BASE_CONFIG: SpawnAgentConfig = {
  prompt: "Test prompt",
  lockPath: "/tmp/test-agent.lock",
  logPath: "/tmp/test-agent-log.jsonl",
  source: "TestHook",
  reason: "test reason",
};

type FakeFS = Map<string, string>;

function fakeDeps(
  fs: FakeFS,
  overrides: Partial<SpawnAgentDeps> = {},
): SpawnAgentDeps {
  const spawned: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
  return {
    fileExists: (p) => fs.has(p),
    readFile: (p) => {
      const c = fs.get(p);
      if (!c)
        return {
          ok: false,
          error: { code: "FILE_NOT_FOUND", message: p },
        } as any;
      return ok(c);
    },
    writeFile: (p, c) => {
      fs.set(p, c);
      return ok(undefined as void);
    },
    appendFile: (p, c) => {
      fs.set(p, (fs.get(p) || "") + c);
      return ok(undefined as void);
    },
    removeFile: (p) => {
      fs.delete(p);
      return ok(undefined as void);
    },
    spawnBackground: (cmd, args, opts) => {
      spawned.push({ cmd, args, cwd: opts?.cwd });
      return ok(undefined as void);
    },
    runnerPath: "/fake/runners/agent-runner.ts",
    stderr: () => {},
    _spawned: spawned,
    ...overrides,
  } as SpawnAgentDeps & { _spawned: typeof spawned };
}

describe("spawnAgent", () => {
  it("spawns background process with correct args", () => {
    const fs: FakeFS = new Map();
    const deps = fakeDeps(fs);
    const result = spawnAgent(BASE_CONFIG, deps);

    expect(result.ok).toBe(true);
    const spawned = (deps as any)._spawned;
    expect(spawned.length).toBe(1);
    expect(spawned[0].cmd).toBe("bun");
    expect(spawned[0].args[0]).toBe("/fake/runners/agent-runner.ts");
    // Second arg is JSON config
    const passedConfig = JSON.parse(spawned[0].args[1]);
    expect(passedConfig.prompt).toBe("Test prompt");
    expect(passedConfig.model).toBe("opus");
    expect(passedConfig.maxTurns).toBe(5);
    expect(passedConfig.timeout).toBe(300000);
  });

  it("writes lock file before spawning", () => {
    const fs: FakeFS = new Map();
    const deps = fakeDeps(fs);
    spawnAgent(BASE_CONFIG, deps);

    const lockContent = fs.get(BASE_CONFIG.lockPath);
    expect(lockContent).toBeDefined();
    const lock = JSON.parse(lockContent!);
    expect(lock.source).toBe("TestHook");
    expect(lock.reason).toBe("test reason");
  });

  it("appends spawned entry to log", () => {
    const fs: FakeFS = new Map();
    const deps = fakeDeps(fs);
    spawnAgent(BASE_CONFIG, deps);

    const logContent = fs.get(BASE_CONFIG.logPath);
    expect(logContent).toBeDefined();
    const entry = JSON.parse(logContent!.trim());
    expect(entry.event).toBe("spawned");
    expect(entry.source).toBe("TestHook");
  });

  it("skips spawn if lock file exists and is not stale", () => {
    const recentLock = JSON.stringify({
      ts: new Date().toISOString(),
      source: "Other",
      reason: "running",
    });
    const fs: FakeFS = new Map([[BASE_CONFIG.lockPath, recentLock]]);
    const deps = fakeDeps(fs);
    const result = spawnAgent(BASE_CONFIG, deps);

    expect(result.ok).toBe(true);
    expect((deps as any)._spawned.length).toBe(0);
  });

  it("replaces stale lock and spawns", () => {
    const oldTs = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min ago
    const staleLock = JSON.stringify({
      ts: oldTs,
      source: "Other",
      reason: "stuck",
    });
    const fs: FakeFS = new Map([[BASE_CONFIG.lockPath, staleLock]]);
    const deps = fakeDeps(fs);
    const result = spawnAgent(BASE_CONFIG, deps);

    expect(result.ok).toBe(true);
    expect((deps as any)._spawned.length).toBe(1);
  });

  it("passes cwd to spawnBackground when provided", () => {
    const fs: FakeFS = new Map();
    const deps = fakeDeps(fs);
    spawnAgent({ ...BASE_CONFIG, cwd: "/some/dir" }, deps);

    const spawned = (deps as any)._spawned;
    expect(spawned[0].cwd).toBe("/some/dir");
  });

  it("uses default model/maxTurns/timeout when not specified", () => {
    const fs: FakeFS = new Map();
    const deps = fakeDeps(fs);
    spawnAgent(BASE_CONFIG, deps);

    const spawned = (deps as any)._spawned;
    const passedConfig = JSON.parse(spawned[0].args[1]);
    expect(passedConfig.model).toBe("opus");
    expect(passedConfig.maxTurns).toBe(5);
    expect(passedConfig.timeout).toBe(300000);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/ian.hogers/.claude/pai-hooks && bun test lib/spawn-agent.test.ts`
Expected: FAIL — `spawn-agent` module does not exist

**Step 3: Write minimal implementation**

Create `lib/spawn-agent.ts`:

```typescript
/**
 * Shared Agent Spawner — Spawn background Claude agents from any hook.
 *
 * Handles lock file management, traceability logging, and background
 * process spawning via the process adapter. The paired runner script
 * (runners/agent-runner.ts) handles cleanup in its finally block.
 */

import { join } from "node:path";
import {
  appendFile,
  fileExists,
  readFile,
  removeFile,
  writeFile,
} from "@hooks/core/adapters/fs";
import { spawnBackground } from "@hooks/core/adapters/process";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";

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
}

export interface SpawnAgentDeps {
  fileExists: (path: string) => boolean;
  readFile: (path: string) => Result<string, ResultError>;
  writeFile: (path: string, content: string) => Result<void, ResultError>;
  appendFile: (path: string, content: string) => Result<void, ResultError>;
  removeFile: (path: string) => Result<void, ResultError>;
  spawnBackground: (
    cmd: string,
    args: string[],
    opts?: { cwd?: string },
  ) => Result<void, ResultError>;
  runnerPath: string;
  stderr: (msg: string) => void;
}

interface LockContent {
  ts: string;
  source: string;
  reason: string;
}

interface LogEntry {
  ts: string;
  event: "spawned";
  source: string;
  reason: string;
  lock: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "opus";
const DEFAULT_MAX_TURNS = 5;
const DEFAULT_TIMEOUT = 300_000; // 5 minutes
const STALE_LOCK_MS = 6 * 60 * 1000; // 6 minutes (timeout + 1 min buffer)

// ─── Pure Logic ─────────────────────────────────────────────────────────────

function isLockStale(lockJson: string): boolean {
  try {
    const lock: LockContent = JSON.parse(lockJson);
    const age = Date.now() - new Date(lock.ts).getTime();
    return age > STALE_LOCK_MS;
  } catch {
    return true; // corrupted lock = stale
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

const defaultDeps: SpawnAgentDeps = {
  fileExists,
  readFile,
  writeFile,
  appendFile,
  removeFile,
  spawnBackground,
  runnerPath: join(import.meta.dir, "../runners/agent-runner.ts"),
  stderr: (msg) => process.stderr.write(`${msg}\n`),
};

export function spawnAgent(
  config: SpawnAgentConfig,
  deps: SpawnAgentDeps = defaultDeps,
): Result<void, ResultError> {
  // 1. Check lock
  if (deps.fileExists(config.lockPath)) {
    const existing = deps.readFile(config.lockPath);
    if (existing.ok && !isLockStale(existing.value)) {
      deps.stderr(
        `[spawn-agent] Lock exists and is fresh, skipping: ${config.lockPath}`,
      );
      return ok(undefined as void);
    }
    // Stale or unreadable — remove and proceed
    deps.removeFile(config.lockPath);
  }

  // 2. Write lock
  const lockContent: LockContent = {
    ts: new Date().toISOString(),
    source: config.source,
    reason: config.reason,
  };
  deps.writeFile(config.lockPath, JSON.stringify(lockContent));

  // 3. Log spawned event
  const logEntry: LogEntry = {
    ts: new Date().toISOString(),
    event: "spawned",
    source: config.source,
    reason: config.reason,
    lock: config.lockPath,
  };
  deps.appendFile(config.logPath, `${JSON.stringify(logEntry)}\n`);

  // 4. Build runner config with defaults applied
  const runnerConfig = {
    prompt: config.prompt,
    model: config.model ?? DEFAULT_MODEL,
    maxTurns: config.maxTurns ?? DEFAULT_MAX_TURNS,
    timeout: config.timeout ?? DEFAULT_TIMEOUT,
    lockPath: config.lockPath,
    logPath: config.logPath,
    source: config.source,
    cwd: config.cwd,
  };

  // 5. Spawn
  deps.stderr(
    `[spawn-agent] Spawning agent for ${config.source}: ${config.reason}`,
  );
  return deps.spawnBackground(
    "bun",
    [deps.runnerPath, JSON.stringify(runnerConfig)],
    {
      cwd: config.cwd,
    },
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/ian.hogers/.claude/pai-hooks && bun test lib/spawn-agent.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
cd /Users/ian.hogers/.claude/pai-hooks
git add lib/spawn-agent.ts lib/spawn-agent.test.ts
git commit -m "feat: add shared spawnAgent() function in lib/spawn-agent.ts

Lock file management, traceability logging, and background process
spawning via spawnBackground(). Any hook can import and use this to
spawn Claude agents without duplicating boilerplate."
```

---

### Task 2: `runners/agent-runner.ts` — Generic runner with dry-run and BUN_TEST guard

**Files:**

- Create: `runners/agent-runner.ts`
- Test: `runners/agent-runner.test.ts`

**Step 1: Write the failing test**

Create `runners/agent-runner.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { ok, type Result } from "@hooks/core/result";
import type { ResultError } from "@hooks/core/error";
import {
  runAgent,
  type RunnerConfig,
  type AgentRunnerDeps,
} from "@hooks/runners/agent-runner";

const BASE_CONFIG: RunnerConfig = {
  prompt: "Test hardening prompt",
  model: "opus",
  maxTurns: 5,
  timeout: 300000,
  lockPath: "/tmp/test-runner.lock",
  logPath: "/tmp/test-runner-log.jsonl",
  source: "TestHook",
};

type FakeFS = Map<string, string>;

function fakeDeps(
  fs: FakeFS,
  overrides: Partial<AgentRunnerDeps> = {},
): AgentRunnerDeps {
  return {
    writeFile: (p, c) => {
      fs.set(p, c);
      return ok(undefined as void);
    },
    appendFile: (p, c) => {
      fs.set(p, (fs.get(p) || "") + c);
      return ok(undefined as void);
    },
    removeFile: (p) => {
      fs.delete(p);
      return ok(undefined as void);
    },
    spawnSyncSafe: (_cmd, _args, _opts) => ok({ stdout: "", exitCode: 0 }),
    stderr: () => {},
    env: { BUN_TEST: "1" },
    ...overrides,
  };
}

// ─── BUN_TEST guard ────────────────────────────────────────────────────────

describe("agent-runner BUN_TEST guard", () => {
  it("throws if BUN_TEST is set and dryRun is false", () => {
    const fs: FakeFS = new Map();
    const deps = fakeDeps(fs);
    expect(() => runAgent(BASE_CONFIG, false, deps)).toThrow("BUN_TEST");
  });

  it("does not throw if BUN_TEST is set and dryRun is true", () => {
    const fs: FakeFS = new Map();
    const deps = fakeDeps(fs);
    expect(() => runAgent(BASE_CONFIG, true, deps)).not.toThrow();
  });

  it("does not throw if BUN_TEST is not set and dryRun is false", () => {
    const fs: FakeFS = new Map();
    const deps = fakeDeps(fs, {
      env: {},
      spawnSyncSafe: () => ok({ stdout: "", exitCode: 0 }),
    });
    expect(() => runAgent(BASE_CONFIG, false, deps)).not.toThrow();
  });
});

// ─── dry-run ───────────────────────────────────────────────────────────────

describe("agent-runner dry-run", () => {
  it("logs dry-run event", () => {
    const fs: FakeFS = new Map();
    const deps = fakeDeps(fs);
    runAgent(BASE_CONFIG, true, deps);

    const logContent = fs.get(BASE_CONFIG.logPath);
    expect(logContent).toBeDefined();
    const entry = JSON.parse(logContent!.trim());
    expect(entry.event).toBe("dry-run");
    expect(entry.source).toBe("TestHook");
  });

  it("does not call spawnSyncSafe in dry-run", () => {
    const fs: FakeFS = new Map();
    let called = false;
    const deps = fakeDeps(fs, {
      spawnSyncSafe: () => {
        called = true;
        return ok({ stdout: "", exitCode: 0 });
      },
    });
    runAgent(BASE_CONFIG, true, deps);
    expect(called).toBe(false);
  });

  it("removes lock file in dry-run", () => {
    const fs: FakeFS = new Map([[BASE_CONFIG.lockPath, "lock"]]);
    const deps = fakeDeps(fs);
    runAgent(BASE_CONFIG, true, deps);
    expect(fs.has(BASE_CONFIG.lockPath)).toBe(false);
  });
});

// ─── real execution (stubbed) ──────────────────────────────────────────────

describe("agent-runner execution", () => {
  it("calls claude with correct args", () => {
    const fs: FakeFS = new Map();
    let capturedArgs: string[] = [];
    const deps = fakeDeps(fs, {
      env: {},
      spawnSyncSafe: (_cmd, args) => {
        capturedArgs = args ?? [];
        return ok({ stdout: "", exitCode: 0 });
      },
    });
    runAgent(BASE_CONFIG, false, deps);

    expect(capturedArgs).toContain("-p");
    expect(capturedArgs).toContain(BASE_CONFIG.prompt);
    expect(capturedArgs).toContain("--max-turns");
    expect(capturedArgs).toContain("5");
    expect(capturedArgs).toContain("--model");
    expect(capturedArgs).toContain("opus");
  });

  it("logs completed event with exit code", () => {
    const fs: FakeFS = new Map();
    const deps = fakeDeps(fs, {
      env: {},
      spawnSyncSafe: () => ok({ stdout: "", exitCode: 0 }),
    });
    runAgent(BASE_CONFIG, false, deps);

    const logContent = fs.get(BASE_CONFIG.logPath);
    expect(logContent).toBeDefined();
    const entry = JSON.parse(logContent!.trim());
    expect(entry.event).toBe("completed");
    expect(entry.exitCode).toBe(0);
  });

  it("logs failed event when spawnSyncSafe returns error", () => {
    const fs: FakeFS = new Map();
    const deps = fakeDeps(fs, {
      env: {},
      spawnSyncSafe: () =>
        ({
          ok: false,
          error: { code: "PROCESS_EXEC_FAILED", message: "boom" },
        }) as any,
    });
    runAgent(BASE_CONFIG, false, deps);

    const logContent = fs.get(BASE_CONFIG.logPath);
    expect(logContent).toBeDefined();
    const entry = JSON.parse(logContent!.trim());
    expect(entry.event).toBe("failed");
  });

  it("removes lock file after execution", () => {
    const fs: FakeFS = new Map([[BASE_CONFIG.lockPath, "lock"]]);
    const deps = fakeDeps(fs, {
      env: {},
      spawnSyncSafe: () => ok({ stdout: "", exitCode: 0 }),
    });
    runAgent(BASE_CONFIG, false, deps);
    expect(fs.has(BASE_CONFIG.lockPath)).toBe(false);
  });

  it("removes lock file even when execution fails", () => {
    const fs: FakeFS = new Map([[BASE_CONFIG.lockPath, "lock"]]);
    const deps = fakeDeps(fs, {
      env: {},
      spawnSyncSafe: () =>
        ({
          ok: false,
          error: { code: "PROCESS_EXEC_FAILED", message: "boom" },
        }) as any,
    });
    runAgent(BASE_CONFIG, false, deps);
    expect(fs.has(BASE_CONFIG.lockPath)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/ian.hogers/.claude/pai-hooks && bun test runners/agent-runner.test.ts`
Expected: FAIL — `agent-runner` module does not exist

**Step 3: Write minimal implementation**

Create `runners/agent-runner.ts`:

```typescript
/**
 * Agent Runner — Generic background runner for Claude agent spawning.
 *
 * Spawned by lib/spawn-agent.ts as a detached bun process.
 * Receives config as a JSON CLI arg, runs claude -p synchronously,
 * then deterministically cleans up lock file and writes traceability log.
 *
 * SAFETY: If BUN_TEST env var is set and --dry-run is not passed,
 * the runner throws immediately. This prevents accidental token burn
 * in test suites.
 */

import { appendFile, removeFile } from "@hooks/core/adapters/fs";
import { spawnSyncSafe } from "@hooks/core/adapters/process";
import type { ResultError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RunnerConfig {
  prompt: string;
  model: string;
  maxTurns: number;
  timeout: number;
  lockPath: string;
  logPath: string;
  source: string;
  cwd?: string;
}

export interface AgentRunnerDeps {
  appendFile: (path: string, content: string) => Result<void, ResultError>;
  removeFile: (path: string) => Result<void, ResultError>;
  writeFile: (path: string, content: string) => Result<void, ResultError>;
  spawnSyncSafe: typeof spawnSyncSafe;
  stderr: (msg: string) => void;
  env: Record<string, string | undefined>;
}

// ─── Runner ─────────────────────────────────────────────────────────────────

const defaultDeps: AgentRunnerDeps = {
  appendFile,
  removeFile,
  writeFile: (await import("@hooks/core/adapters/fs")).writeFile,
  spawnSyncSafe,
  stderr: (msg) => process.stderr.write(`${msg}\n`),
  env: process.env as Record<string, string | undefined>,
};

function logEvent(
  logPath: string,
  entry: Record<string, unknown>,
  deps: AgentRunnerDeps,
): void {
  deps.appendFile(logPath, `${JSON.stringify(entry)}\n`);
}

export function runAgent(
  config: RunnerConfig,
  dryRun: boolean,
  deps: AgentRunnerDeps = defaultDeps,
): void {
  // SAFETY GUARD: Never run real claude in test environment
  if (deps.env.BUN_TEST && !dryRun) {
    throw new Error(
      "BUN_TEST is set but --dry-run was not passed. " +
        "Refusing to spawn real claude agent in test environment.",
    );
  }

  const startMs = Date.now();

  try {
    if (dryRun) {
      logEvent(
        config.logPath,
        {
          ts: new Date().toISOString(),
          event: "dry-run",
          source: config.source,
          prompt_length: config.prompt.length,
          model: config.model,
          maxTurns: config.maxTurns,
        },
        deps,
      );
      deps.stderr(
        `[agent-runner] DRY RUN for ${config.source} — skipping claude`,
      );
      return;
    }

    // Run claude synchronously
    const result = deps.spawnSyncSafe(
      "claude",
      [
        "-p",
        config.prompt,
        "--max-turns",
        String(config.maxTurns),
        "--model",
        config.model,
      ],
      {
        cwd: config.cwd,
        timeout: config.timeout,
        stdio: "ignore",
      },
    );

    const durationMs = Date.now() - startMs;

    if (result.ok) {
      logEvent(
        config.logPath,
        {
          ts: new Date().toISOString(),
          event: "completed",
          source: config.source,
          exitCode: result.value.exitCode,
          duration_ms: durationMs,
        },
        deps,
      );
      deps.stderr(
        `[agent-runner] Completed ${config.source} (exit=${result.value.exitCode}, ${durationMs}ms)`,
      );
    } else {
      logEvent(
        config.logPath,
        {
          ts: new Date().toISOString(),
          event: "failed",
          source: config.source,
          error: result.error.message,
          duration_ms: durationMs,
        },
        deps,
      );
      deps.stderr(
        `[agent-runner] Failed ${config.source}: ${result.error.message}`,
      );
    }
  } finally {
    // Always clean up lock file
    deps.removeFile(config.lockPath);
  }
}

// ─── Script entry point ─────────────────────────────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const configArg = args.find((a) => !a.startsWith("--"));

  if (!configArg) {
    process.stderr.write("[agent-runner] Missing config JSON argument\n");
    process.exit(1);
  }

  const config: RunnerConfig = JSON.parse(configArg);
  runAgent(config, dryRun);
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/ian.hogers/.claude/pai-hooks && bun test runners/agent-runner.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
cd /Users/ian.hogers/.claude/pai-hooks
git add runners/agent-runner.ts runners/agent-runner.test.ts
git commit -m "feat: add generic agent-runner with dry-run and BUN_TEST guard

Receives config as JSON CLI arg, runs claude -p synchronously,
logs completed/failed to traceability JSONL, cleans up lock in finally.
Throws immediately if BUN_TEST is set without --dry-run."
```

---

### Task 3: `buildHardeningPrompt()` — Pure function for the hardening agent's prompt

**Files:**

- Create: `hooks/SecurityValidator/SettingsRevert/hardening-prompt.ts`
- Test: `hooks/SecurityValidator/SettingsRevert/hardening-prompt.test.ts`

**Step 1: Write the failing test**

Create `hooks/SecurityValidator/SettingsRevert/hardening-prompt.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { buildHardeningPrompt } from "@hooks/hooks/SecurityValidator/SettingsRevert/hardening-prompt";

describe("buildHardeningPrompt", () => {
  it("includes the bypass command", () => {
    const prompt = buildHardeningPrompt(
      "jq '.hooks = {}' settings.json > tmp && mv tmp settings.json",
    );
    expect(prompt).toContain(
      "jq '.hooks = {}' settings.json > tmp && mv tmp settings.json",
    );
  });

  it("references patterns.yaml path", () => {
    const prompt = buildHardeningPrompt("sed -i '' 's/x/y/' settings.json");
    expect(prompt).toContain("PAI/USER/PAISECURITYSYSTEM/patterns.yaml");
  });

  it("instructs to add under bash.blocked", () => {
    const prompt = buildHardeningPrompt(
      'python3 -c \'open("settings.json","w")\'',
    );
    expect(prompt).toContain("bash.blocked");
    expect(prompt).toContain("blocked");
  });

  it("instructs to include Auto-hardened in reason", () => {
    const prompt = buildHardeningPrompt(
      'node -e \'fs.writeFileSync("settings.json","{}")\'',
    );
    expect(prompt).toContain("Auto-hardened");
  });

  it("instructs to run bun test", () => {
    const prompt = buildHardeningPrompt("echo '{}' > settings.json");
    expect(prompt).toContain("bun test");
  });

  it("instructs to commit the change", () => {
    const prompt = buildHardeningPrompt("cp /tmp/evil settings.json");
    expect(prompt).toContain("commit");
  });

  it("instructs to avoid false positives", () => {
    const prompt = buildHardeningPrompt(
      "jq . settings.json > tmp && mv tmp settings.json",
    );
    expect(prompt).toContain("false positive");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/ian.hogers/.claude/pai-hooks && bun test hooks/SecurityValidator/SettingsRevert/hardening-prompt.test.ts`
Expected: FAIL — module does not exist

**Step 3: Write minimal implementation**

Create `hooks/SecurityValidator/SettingsRevert/hardening-prompt.ts`:

```typescript
/**
 * Hardening Prompt Builder — Creates the prompt for the auto-hardening agent.
 *
 * Pure function, no I/O. The prompt instructs a Claude agent to read
 * patterns.yaml and add a blocked pattern that catches the bypass command.
 */

export function buildHardeningPrompt(bypassCommand: string): string {
  const date = new Date().toISOString().split("T")[0];
  return [
    "You are a security hardening agent. A Bash command bypassed settings.json protection and was caught by the SettingsRevert hook.",
    "",
    `The bypass command was: ${bypassCommand}`,
    "",
    "Your task:",
    "",
    "1. Read ~/.claude/PAI/USER/PAISECURITYSYSTEM/patterns.yaml",
    "2. Add a new entry under the bash.blocked section that would catch this command BEFORE it executes",
    "3. The pattern should be specific enough to avoid false positives on legitimate uses of the same tool",
    `4. Set the reason field to: "Auto-hardened: <short description of what the pattern blocks> (caught ${date})"`,
    "5. Run: cd ~/.claude/pai-hooks && bun test hooks/SecurityValidator/SecurityValidator/SecurityValidator.test.ts",
    "6. If tests pass, commit with a message like: security: auto-harden patterns.yaml against <tool> bypass",
    "7. Include the original bypass command in the commit body for traceability",
    "",
    "Rules:",
    "- Only add to bash.blocked. Do not modify any other section.",
    "- Do not remove or modify existing patterns.",
    "- The pattern should catch the bypass vector, not just the exact command. For example, if the command was `jq '.hooks = {}' settings.json > tmp && mv tmp settings.json`, a good pattern targets jq writing to settings.json, not just that exact jq expression.",
    "- If the bypass vector is already covered by an existing pattern, do nothing and explain why.",
    "- Keep the YAML formatting consistent with existing entries.",
  ].join("\n");
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/ian.hogers/.claude/pai-hooks && bun test hooks/SecurityValidator/SettingsRevert/hardening-prompt.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
cd /Users/ian.hogers/.claude/pai-hooks
git add hooks/SecurityValidator/SettingsRevert/hardening-prompt.ts hooks/SecurityValidator/SettingsRevert/hardening-prompt.test.ts
git commit -m "feat: add buildHardeningPrompt() pure function

Creates the prompt for the auto-hardening agent that updates
patterns.yaml when SettingsRevert catches a bypass."
```

---

### Task 4: Wire SettingsRevert to call `spawnAgent()` after revert

**Files:**

- Modify: `hooks/SecurityValidator/SettingsRevert/SettingsRevert.contract.ts:28-35` (deps interface)
- Modify: `hooks/SecurityValidator/SettingsRevert/SettingsRevert.contract.ts:106-148` (contract)
- Modify: `hooks/SecurityValidator/SettingsRevert/SettingsRevert.test.ts` (add new tests)

**Step 1: Write the failing test**

Add to `hooks/SecurityValidator/SettingsRevert/SettingsRevert.test.ts`:

```typescript
// At top, add imports:
import type { SpawnAgentConfig } from "@hooks/lib/spawn-agent";

// Update postDeps to include spawnAgent stub:
// Add to the FakeFS-based postDeps function a spawnAgent tracker:

// Add new describe block at the end:

describe("SettingsRevert.execute — hardening agent spawn", () => {
  it("calls spawnAgent after revert with correct source", () => {
    const fs: FakeFS = new Map([
      [SETTINGS_PATH, MODIFIED],
      [SNAP_MAIN, ORIGINAL],
    ]);
    const spawns: SpawnAgentConfig[] = [];
    const deps = postDeps(fs, {
      spawnAgent: (config: SpawnAgentConfig) => {
        spawns.push(config);
        return ok(undefined as void);
      },
    });
    SettingsRevert.execute(bashInput("jq . settings.json"), deps);

    expect(spawns.length).toBe(1);
    expect(spawns[0].source).toBe("SettingsRevert");
    expect(spawns[0].reason).toContain("jq");
  });

  it("does not call spawnAgent when no revert happens", () => {
    const fs: FakeFS = new Map([
      [SETTINGS_PATH, ORIGINAL],
      [SNAP_MAIN, ORIGINAL],
    ]);
    const spawns: SpawnAgentConfig[] = [];
    const deps = postDeps(fs, {
      spawnAgent: (config: SpawnAgentConfig) => {
        spawns.push(config);
        return ok(undefined as void);
      },
    });
    SettingsRevert.execute(bashInput("git status"), deps);

    expect(spawns.length).toBe(0);
  });

  it("passes the bypass command in the prompt", () => {
    const fs: FakeFS = new Map([
      [SETTINGS_PATH, MODIFIED],
      [SNAP_MAIN, ORIGINAL],
    ]);
    const spawns: SpawnAgentConfig[] = [];
    const deps = postDeps(fs, {
      spawnAgent: (config: SpawnAgentConfig) => {
        spawns.push(config);
        return ok(undefined as void);
      },
    });
    SettingsRevert.execute(bashInput("python3 -c 'write settings'"), deps);

    expect(spawns[0].prompt).toContain("python3 -c 'write settings'");
  });

  it("uses correct lockPath and logPath", () => {
    const fs: FakeFS = new Map([
      [SETTINGS_PATH, MODIFIED],
      [SNAP_MAIN, ORIGINAL],
    ]);
    const spawns: SpawnAgentConfig[] = [];
    const deps = postDeps(fs, {
      spawnAgent: (config: SpawnAgentConfig) => {
        spawns.push(config);
        return ok(undefined as void);
      },
    });
    SettingsRevert.execute(bashInput("evil cmd"), deps);

    expect(spawns[0].lockPath).toBe("/tmp/pai-hardening-agent.lock");
    expect(spawns[0].logPath).toContain("MEMORY/SECURITY/hardening-log.jsonl");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/ian.hogers/.claude/pai-hooks && bun test hooks/SecurityValidator/SettingsRevert/SettingsRevert.test.ts`
Expected: FAIL — `spawnAgent` not in deps type

**Step 3: Modify SettingsRevert contract**

In `SettingsRevert.contract.ts`, make these changes:

1. Add import at top:

```typescript
import { spawnAgent, type SpawnAgentConfig } from "@hooks/lib/spawn-agent";
import { buildHardeningPrompt } from "@hooks/hooks/SecurityValidator/SettingsRevert/hardening-prompt";
```

2. Add `spawnAgent` to `SettingsRevertDeps`:

```typescript
export interface SettingsRevertDeps extends AuditLogDeps {
  // ... existing fields ...
  spawnAgent: (config: SpawnAgentConfig) => Result<void, ResultError>;
}
```

3. Add to `defaultDeps`:

```typescript
spawnAgent: (config) => spawnAgent(config),
```

4. After the `logSettingsAudit` call, when `reverted.length > 0`, add:

```typescript
deps.spawnAgent({
  prompt: buildHardeningPrompt(command),
  lockPath: "/tmp/pai-hardening-agent.lock",
  logPath: join(deps.baseDir, "MEMORY/SECURITY/hardening-log.jsonl"),
  source: "SettingsRevert",
  reason: `bypass: ${command.slice(0, 200)}`,
});
```

**Step 4: Run tests to verify they pass**

Run: `cd /Users/ian.hogers/.claude/pai-hooks && bun test hooks/SecurityValidator/SettingsRevert/`
Expected: ALL PASS (both old and new tests)

**Step 5: Run full SecurityValidator test suite**

Run: `cd /Users/ian.hogers/.claude/pai-hooks && bun test hooks/SecurityValidator/`
Expected: ALL PASS

**Step 6: Commit**

```bash
cd /Users/ian.hogers/.claude/pai-hooks
git add hooks/SecurityValidator/SettingsRevert/SettingsRevert.contract.ts hooks/SecurityValidator/SettingsRevert/SettingsRevert.test.ts
git commit -m "feat: wire SettingsRevert to spawn hardening agent after revert

When a settings.json bypass is caught and reverted, SettingsRevert
now spawns a background Claude agent via spawnAgent() to auto-add
a blocked pattern to patterns.yaml."
```

---

### Task 5: Full integration test (dry-run) and final verification

**Files:**

- No new files — run existing tests across all touched modules

**Step 1: Run all lib tests**

Run: `cd /Users/ian.hogers/.claude/pai-hooks && bun test lib/spawn-agent.test.ts`
Expected: ALL PASS

**Step 2: Run all runner tests**

Run: `cd /Users/ian.hogers/.claude/pai-hooks && bun test runners/agent-runner.test.ts`
Expected: ALL PASS

**Step 3: Run all SecurityValidator group tests**

Run: `cd /Users/ian.hogers/.claude/pai-hooks && bun test hooks/SecurityValidator/`
Expected: ALL PASS

**Step 4: Run hardening prompt tests**

Run: `cd /Users/ian.hogers/.claude/pai-hooks && bun test hooks/SecurityValidator/SettingsRevert/hardening-prompt.test.ts`
Expected: ALL PASS

**Step 5: Run full test suite to check for regressions**

Run: `cd /Users/ian.hogers/.claude/pai-hooks && bun test`
Expected: ALL PASS, no regressions

**Step 6: Type check**

Run: `cd /Users/ian.hogers/.claude/pai-hooks && npx tsc --noEmit`
Expected: No type errors

**Step 7: Commit (if any fixups needed)**

Only if previous steps required changes. Otherwise, this task is verification only.

---

### Task 6: Dogfooding — End-to-end verification of the full hardening chain

**Purpose:** Verify the entire chain works in a real environment: bypass attempt → revert → agent spawn → patterns.yaml updated → new pattern blocks the same bypass.

**Prerequisites:** All previous tasks committed and tests passing.

**Step 1: Record baseline state**

Run: `cd /Users/ian.hogers/.claude/pai-hooks && cat ~/.claude/PAI/USER/PAISECURITYSYSTEM/patterns.yaml | wc -l`
Note the line count.

Run: `cat ~/.claude/MEMORY/SECURITY/settings-audit.jsonl 2>/dev/null | tail -1`
Note the last audit entry (or note the file doesn't exist yet).

Run: `cat ~/.claude/MEMORY/SECURITY/hardening-log.jsonl 2>/dev/null | tail -1`
Note the last hardening log entry (or note the file doesn't exist yet).

**Step 2: Snapshot settings.json before the test**

Run: `cp ~/.claude/settings.json /tmp/pai-dogfood-settings-backup.json`
This is a safety net in case something goes wrong during dogfooding.

**Step 3: Trigger a bypass via Bash**

In a Claude Code session (not in tests), run a Bash command that modifies settings.json through an indirect vector. Use something benign:

```bash
python3 -c "
import json
with open('$HOME/.claude/settings.json') as f: data = json.load(f)
data['_dogfood_test'] = True
with open('$HOME/.claude/settings.json', 'w') as f: json.dump(data, f, indent=2)
"
```

Expected: The command executes, but SettingsGuard snapshots before and SettingsRevert reverts after.

**Step 4: Verify revert happened**

Run: `cat ~/.claude/settings.json | python3 -c "import sys,json; d=json.load(sys.stdin); print('_dogfood_test' in d)"`
Expected: `False` — the `_dogfood_test` key should NOT be present (reverted).

Run: `cat ~/.claude/MEMORY/SECURITY/settings-audit.jsonl | tail -1 | python3 -c "import sys,json; e=json.load(sys.stdin); print(e['action'], e['command'][:80])"`
Expected: `reverted python3 -c ...` — confirms the revert was logged with the command.

**Step 5: Verify hardening agent was spawned**

Run: `cat ~/.claude/MEMORY/SECURITY/hardening-log.jsonl | tail -1 | python3 -c "import sys,json; e=json.load(sys.stdin); print(e['event'], e['source'])"`
Expected: `spawned SettingsRevert` — confirms spawnAgent() was called.

Run: `cat /tmp/pai-hardening-agent.lock 2>/dev/null && echo "LOCK EXISTS" || echo "LOCK GONE"`
If the agent is still running: `LOCK EXISTS`. If it finished: `LOCK GONE`.

**Step 6: Wait for hardening agent to complete (up to 5 min)**

Run: `while [ -f /tmp/pai-hardening-agent.lock ]; do echo "Agent still running..."; sleep 10; done; echo "Agent finished"`
Expected: Completes within 5 minutes.

Run: `cat ~/.claude/MEMORY/SECURITY/hardening-log.jsonl | tail -1 | python3 -c "import sys,json; e=json.load(sys.stdin); print(e['event'], e.get('exitCode', 'N/A'))"`
Expected: `completed 0` — agent finished successfully.

**Step 7: Verify patterns.yaml was updated**

Run: `cd /Users/ian.hogers/.claude/pai-hooks && git diff ~/.claude/PAI/USER/PAISECURITYSYSTEM/patterns.yaml`
Expected: A new entry under `bash.blocked` with:

- A pattern targeting the python3 write vector
- `reason:` containing `Auto-hardened` and today's date

Run: `cd /Users/ian.hogers/.claude/pai-hooks && git log --oneline -1 ~/.claude/PAI/USER/PAISECURITYSYSTEM/patterns.yaml`
Expected: A commit message like `security: auto-harden patterns.yaml against python3 bypass`

**Step 8: Verify the new pattern blocks the same bypass**

Run the same python3 command from Step 3 again. This time SecurityValidator should catch it pre-execution.

Expected: The command is **blocked** by SecurityValidator before it runs, with a message referencing the new pattern. SettingsRevert should NOT need to revert because the command never executed.

**Step 9: Verify no new hardening agent spawned**

Run: `cat ~/.claude/MEMORY/SECURITY/hardening-log.jsonl | wc -l`
Expected: Same count as after Step 6 — no new `spawned` entry because SecurityValidator blocked it before SettingsRevert was involved.

**Step 10: Clean up**

Run: `rm /tmp/pai-dogfood-settings-backup.json`

If the auto-hardened pattern is too broad or has issues, manually edit `~/.claude/PAI/USER/PAISECURITYSYSTEM/patterns.yaml` to refine it. The dogfood test pattern should remain as a real defense — it's a valid bypass vector.

**Step 11: Document results**

Append a summary to `docs/plans/2026-04-09-spawn-agent-hardening-design.md`:

```markdown
## Dogfooding Results

- **Date:** YYYY-MM-DD
- **Bypass vector tested:** python3 -c file write
- **Revert:** [PASS/FAIL] — settings.json reverted correctly
- **Agent spawn:** [PASS/FAIL] — hardening agent spawned
- **Pattern added:** [PASS/FAIL] — patterns.yaml updated with new blocked entry
- **Re-block:** [PASS/FAIL] — same bypass blocked pre-execution on retry
- **Notes:** [any observations, issues, or refinements needed]
```
