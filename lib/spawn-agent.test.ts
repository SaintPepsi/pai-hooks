/**
 * Unit tests for spawnAgent() — shared background agent spawning.
 *
 * All tests use a FakeFS (Map<string, string>) pattern and stub deps.
 * No real processes are ever spawned.
 */

import { describe, expect, it } from "bun:test";
import { ErrorCode, ResultError } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import { spawnAgent } from "@hooks/lib/spawn-agent";
import type { SpawnAgentConfig, SpawnAgentDeps } from "@hooks/lib/spawn-agent";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeFakeDeps(overrides: Partial<SpawnAgentDeps> = {}): SpawnAgentDeps {
  const files = new Map<string, string>();
  const stderrMessages: string[] = [];

  return {
    fileExists: (path) => files.has(path),
    readFile: (path) => {
      const content = files.get(path);
      if (content === undefined) {
        return err(new ResultError(ErrorCode.FileNotFound, `Not found: ${path}`));
      }
      return ok(content);
    },
    writeFile: (path, content) => {
      files.set(path, content);
      return ok(undefined);
    },
    appendFile: (path, content) => {
      const existing = files.get(path) ?? "";
      files.set(path, existing + content);
      return ok(undefined);
    },
    removeFile: (path) => {
      files.delete(path);
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

function makeConfig(overrides: Partial<SpawnAgentConfig> = {}): SpawnAgentConfig {
  return {
    prompt: "Analyze things",
    lockPath: "/tmp/test.lock",
    logPath: "/tmp/test.jsonl",
    source: "TestHook",
    reason: "unit test",
    ...overrides,
  };
}

// ─── Spawns background process with correct args ───────────────────────────

describe("spawnAgent", () => {
  it("spawns background process with correct args (bun, runnerPath, JSON config)", () => {
    const spawnCalls: Array<{ cmd: string; args: string[]; opts?: { cwd?: string } }> = [];
    const deps = makeFakeDeps({
      spawnBackground: (cmd, args, opts) => {
        spawnCalls.push({ cmd, args, opts });
        return ok(undefined);
      },
    });
    const config = makeConfig();

    const result = spawnAgent(config, deps);

    expect(result.ok).toBe(true);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cmd).toBe("bun");
    expect(spawnCalls[0].args[0]).toBe("/fake/runner.ts");

    // Second arg should be valid JSON with config
    const parsed = JSON.parse(spawnCalls[0].args[1]);
    expect(parsed.prompt).toBe("Analyze things");
    expect(parsed.model).toBe("opus");
    expect(parsed.maxTurns).toBe(5);
    expect(parsed.timeout).toBe(300_000);
  });

  // ─── Writes lock file before spawning ──────────────────────────────────────

  it("writes lock file before spawning (with source and reason)", () => {
    const callOrder: string[] = [];
    const files = new Map<string, string>();

    const deps = makeFakeDeps({
      writeFile: (path, content) => {
        files.set(path, content);
        if (path.endsWith(".lock")) callOrder.push("writeLock");
        return ok(undefined);
      },
      spawnBackground: () => {
        callOrder.push("spawn");
        return ok(undefined);
      },
    });
    const config = makeConfig();

    spawnAgent(config, deps);

    expect(callOrder).toEqual(["writeLock", "spawn"]);

    // Lock file content should include source and reason
    const lockContent = files.get("/tmp/test.lock");
    expect(lockContent).toBeDefined();
    const lockData = JSON.parse(lockContent!);
    expect(lockData.source).toBe("TestHook");
    expect(lockData.reason).toBe("unit test");
    expect(lockData.ts).toBeDefined();
  });

  // ─── Appends spawned entry to log ──────────────────────────────────────────

  it("appends spawned entry to log (with event and source fields)", () => {
    let appendedContent = "";
    const deps = makeFakeDeps({
      appendFile: (_path, content) => {
        appendedContent = content;
        return ok(undefined);
      },
    });
    const config = makeConfig();

    spawnAgent(config, deps);

    expect(appendedContent).toBeTruthy();
    const logEntry = JSON.parse(appendedContent.trim());
    expect(logEntry.event).toBe("spawned");
    expect(logEntry.source).toBe("TestHook");
    expect(logEntry.ts).toBeDefined();
  });

  // ─── Skips spawn if lock file is fresh ─────────────────────────────────────

  it("skips spawn if lock file exists and is not stale", () => {
    let spawnCalled = false;
    const freshLock = JSON.stringify({
      ts: new Date().toISOString(),
      source: "OtherHook",
      reason: "already running",
    });

    const files = new Map<string, string>([["/tmp/test.lock", freshLock]]);
    const deps = makeFakeDeps({
      fileExists: (path) => files.has(path),
      readFile: (path) => {
        const content = files.get(path);
        return content !== undefined
          ? ok(content)
          : err(new ResultError(ErrorCode.FileNotFound, "not found"));
      },
      spawnBackground: () => {
        spawnCalled = true;
        return ok(undefined);
      },
    });
    const config = makeConfig();

    const result = spawnAgent(config, deps);

    expect(result.ok).toBe(true);
    expect(spawnCalled).toBe(false);
  });

  // ─── Replaces stale lock ───────────────────────────────────────────────────

  it("replaces stale lock (>6 min old) and spawns", () => {
    let spawnCalled = false;
    const staleTs = new Date(Date.now() - 7 * 60 * 1000).toISOString(); // 7 min ago
    const staleLock = JSON.stringify({
      ts: staleTs,
      source: "OldHook",
      reason: "stale",
    });

    const files = new Map<string, string>([["/tmp/test.lock", staleLock]]);
    const deps = makeFakeDeps({
      fileExists: (path) => files.has(path),
      readFile: (path) => {
        const content = files.get(path);
        return content !== undefined
          ? ok(content)
          : err(new ResultError(ErrorCode.FileNotFound, "not found"));
      },
      writeFile: (path, content) => {
        files.set(path, content);
        return ok(undefined);
      },
      removeFile: (path) => {
        files.delete(path);
        return ok(undefined);
      },
      spawnBackground: () => {
        spawnCalled = true;
        return ok(undefined);
      },
    });
    const config = makeConfig();

    const result = spawnAgent(config, deps);

    expect(result.ok).toBe(true);
    expect(spawnCalled).toBe(true);

    // New lock should have been written with current source
    const newLock = files.get("/tmp/test.lock");
    expect(newLock).toBeDefined();
    const parsed = JSON.parse(newLock!);
    expect(parsed.source).toBe("TestHook");
  });

  // ─── Passes cwd to spawnBackground ─────────────────────────────────────────

  it("passes cwd to spawnBackground when provided", () => {
    let spawnOpts: { cwd?: string } | undefined;
    const deps = makeFakeDeps({
      spawnBackground: (_cmd, _args, opts) => {
        spawnOpts = opts;
        return ok(undefined);
      },
    });
    const config = makeConfig({ cwd: "/my/project" });

    spawnAgent(config, deps);

    expect(spawnOpts).toBeDefined();
    expect(spawnOpts!.cwd).toBe("/my/project");
  });

  // ─── Uses defaults when not specified ──────────────────────────────────────

  it("uses default model/maxTurns/timeout when not specified (opus, 5, 300000)", () => {
    const spawnCalls: Array<{ args: string[] }> = [];
    const deps = makeFakeDeps({
      spawnBackground: (_cmd, args) => {
        spawnCalls.push({ args });
        return ok(undefined);
      },
    });
    const config = makeConfig(); // no model, maxTurns, timeout

    spawnAgent(config, deps);

    expect(spawnCalls).toHaveLength(1);
    const parsed = JSON.parse(spawnCalls[0].args[1]);
    expect(parsed.model).toBe("opus");
    expect(parsed.maxTurns).toBe(5);
    expect(parsed.timeout).toBe(300_000);
  });

  // ─── Respects custom model/maxTurns/timeout ────────────────────────────────

  it("uses custom model/maxTurns/timeout when provided", () => {
    const spawnCalls: Array<{ args: string[] }> = [];
    const deps = makeFakeDeps({
      spawnBackground: (_cmd, args) => {
        spawnCalls.push({ args });
        return ok(undefined);
      },
    });
    const config = makeConfig({ model: "sonnet", maxTurns: 10, timeout: 600_000 });

    spawnAgent(config, deps);

    const parsed = JSON.parse(spawnCalls[0].args[1]);
    expect(parsed.model).toBe("sonnet");
    expect(parsed.maxTurns).toBe(10);
    expect(parsed.timeout).toBe(600_000);
  });
});
