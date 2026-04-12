import { describe, expect, test } from "bun:test";
import { fileNotFound, processSpawnFailed } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import type { AgentRunnerDeps, RunnerConfig } from "@hooks/runners/agent-runner";
import { runAgent } from "@hooks/runners/agent-runner";

// ─── Test Helpers ──────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    prompt: "test prompt",
    model: "opus",
    maxTurns: 5,
    timeout: 60000,
    lockPath: "/tmp/test.lock",
    logPath: "/tmp/test.log",
    source: "test-hook",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<AgentRunnerDeps> = {}): AgentRunnerDeps {
  return {
    appendFile: () => ok(undefined),
    readFile: () => err(fileNotFound("no-session")),
    removeFile: () => ok(undefined),
    writeFile: () => ok(undefined),
    spawnSyncSafe: () => ok({ stdout: "", stderr: "", exitCode: 0 }),
    stderr: () => {},
    env: { BUN_TEST: "1" },
    ...overrides,
  };
}

// ─── BUN_TEST Guard ────────────────────────────────────────────────────────

describe("agent-runner / BUN_TEST guard", () => {
  test("throws if BUN_TEST is set and dryRun is false", () => {
    const deps = makeDeps({ env: { BUN_TEST: "1" } });
    expect(() => runAgent(makeConfig(), false, deps)).toThrow("BUN_TEST");
  });

  test("does not throw if BUN_TEST is set and dryRun is true", () => {
    const deps = makeDeps({ env: { BUN_TEST: "1" } });
    expect(() => runAgent(makeConfig(), true, deps)).not.toThrow();
  });

  test("does not throw if BUN_TEST is not set and dryRun is false", () => {
    const deps = makeDeps({ env: {} });
    expect(() => runAgent(makeConfig(), false, deps)).not.toThrow();
  });
});

// ─── Dry-run Mode ──────────────────────────────────────────────────────────

describe("agent-runner / dry-run mode", () => {
  test("logs dry-run event to logPath", () => {
    const logged: Array<{ path: string; content: string }> = [];
    const deps = makeDeps({
      appendFile: (p, content) => {
        logged.push({ path: p, content });
        return ok(undefined);
      },
    });
    runAgent(makeConfig(), true, deps);
    expect(logged.some((l) => l.content.includes("dry-run"))).toBe(true);
  });

  test("does NOT call spawnSyncSafe in dry-run", () => {
    let spawnCalled = false;
    const deps = makeDeps({
      spawnSyncSafe: () => {
        spawnCalled = true;
        return ok({ stdout: "", stderr: "", exitCode: 0 });
      },
    });
    runAgent(makeConfig(), true, deps);
    expect(spawnCalled).toBe(false);
  });

  test("removes lock file in dry-run (via finally)", () => {
    const removed: string[] = [];
    const config = makeConfig({ lockPath: "/tmp/dry-run-test.lock" });
    const deps = makeDeps({
      removeFile: (p) => {
        removed.push(p);
        return ok(undefined);
      },
    });
    runAgent(config, true, deps);
    expect(removed).toContain("/tmp/dry-run-test.lock");
  });
});

// ─── Real Execution (stubbed) ──────────────────────────────────────────────

describe("agent-runner / real execution", () => {
  test("calls claude with correct args (-p, prompt, --max-turns, 5, --model, opus)", () => {
    let calledWith: { cmd: string; args: string[] } | null = null;
    const deps = makeDeps({
      env: {},
      spawnSyncSafe: (cmd, args) => {
        calledWith = { cmd, args };
        return ok({ stdout: "", stderr: "", exitCode: 0 });
      },
    });
    runAgent(makeConfig({ prompt: "do the thing", model: "opus", maxTurns: 5 }), false, deps);
    expect(calledWith).not.toBeNull();
    expect(calledWith!.cmd).toBe("claude");
    expect(calledWith!.args).toContain("-p");
    expect(calledWith!.args).toContain("do the thing");
    expect(calledWith!.args).toContain("--max-turns");
    expect(calledWith!.args).toContain("5");
    expect(calledWith!.args).toContain("--model");
    expect(calledWith!.args).toContain("opus");
  });

  test("logs completed event with exitCode", () => {
    const logged: Array<{ path: string; content: string }> = [];
    const deps = makeDeps({
      env: {},
      appendFile: (p, content) => {
        logged.push({ path: p, content });
        return ok(undefined);
      },
    });
    runAgent(makeConfig(), false, deps);
    const entry = logged.find((l) => l.content.includes('"completed"'));
    expect(entry).toBeDefined();
    const parsed = JSON.parse(entry!.content.trim());
    expect(parsed.event).toBe("completed");
    expect(parsed.exitCode).toBe(0);
  });

  test("logs failed event when spawnSyncSafe returns error", () => {
    const logged: Array<{ path: string; content: string }> = [];
    const deps = makeDeps({
      env: {},
      spawnSyncSafe: () => err(processSpawnFailed("claude", new Error("timeout"))),
      appendFile: (p, content) => {
        logged.push({ path: p, content });
        return ok(undefined);
      },
    });
    runAgent(makeConfig(), false, deps);
    expect(logged.some((l) => l.content.includes("failed"))).toBe(true);
  });

  test("removes lock file after execution", () => {
    const removed: string[] = [];
    const config = makeConfig({ lockPath: "/tmp/real-test.lock" });
    const deps = makeDeps({
      env: {},
      removeFile: (p) => {
        removed.push(p);
        return ok(undefined);
      },
    });
    runAgent(config, false, deps);
    expect(removed).toContain("/tmp/real-test.lock");
  });

  test("forwards claude stderr to deps.stderr when non-empty", () => {
    const stderrMessages: string[] = [];
    const deps = makeDeps({
      env: {},
      spawnSyncSafe: () => ok({ stdout: "", stderr: "Error: rate limit exceeded", exitCode: 1 }),
      stderr: (msg) => stderrMessages.push(msg),
    });
    runAgent(makeConfig(), false, deps);
    expect(stderrMessages.some((m) => m.includes("rate limit exceeded"))).toBe(true);
    expect(stderrMessages.some((m) => m.includes("[agent-runner]"))).toBe(true);
  });

  test("does not call deps.stderr when claude stderr is empty", () => {
    const stderrMessages: string[] = [];
    const deps = makeDeps({
      env: {},
      spawnSyncSafe: () => ok({ stdout: "", stderr: "", exitCode: 0 }),
      stderr: (msg) => stderrMessages.push(msg),
    });
    runAgent(makeConfig(), false, deps);
    expect(stderrMessages).toHaveLength(0);
  });

  test("removes lock file even when execution fails", () => {
    const removed: string[] = [];
    const config = makeConfig({ lockPath: "/tmp/fail-test.lock" });
    const deps = makeDeps({
      env: {},
      spawnSyncSafe: () => err(processSpawnFailed("claude", new Error("boom"))),
      removeFile: (p) => {
        removed.push(p);
        return ok(undefined);
      },
    });
    runAgent(config, false, deps);
    expect(removed).toContain("/tmp/fail-test.lock");
  });
});

// ─── Session Resumption ──────────────────────────────────────────────────

describe("agent-runner / session resumption", () => {
  test("passes --resume when session state file exists", () => {
    const calls: string[][] = [];
    const deps = makeDeps({
      env: {},
      readFile: (p) => (p.endsWith(".session") ? ok("prev-session-123") : err(fileNotFound(p))),
      spawnSyncSafe: (_cmd, args) => {
        calls.push(args);
        return ok({ stdout: '{"session_id":"new-session-456"}', stderr: "", exitCode: 0 });
      },
    });
    const config = makeConfig({ sessionStatePath: "/tmp/test.session" });
    runAgent(config, false, deps);

    expect(calls[0]).toContain("--resume");
    expect(calls[0]).toContain("prev-session-123");
  });

  test("does not pass --resume when no session state file", () => {
    const calls: string[][] = [];
    const deps = makeDeps({
      env: {},
      spawnSyncSafe: (_cmd, args) => {
        calls.push(args);
        return ok({ stdout: '{"session_id":"fresh-session"}', stderr: "", exitCode: 0 });
      },
    });
    const config = makeConfig({ sessionStatePath: "/tmp/test.session" });
    runAgent(config, false, deps);

    expect(calls[0]).not.toContain("--resume");
  });

  test("writes session ID to state file after success", () => {
    const written: Array<{ path: string; content: string }> = [];
    const deps = makeDeps({
      env: {},
      spawnSyncSafe: () =>
        ok({ stdout: '{"session_id":"saved-session-789"}', stderr: "", exitCode: 0 }),
      writeFile: (p, c) => {
        written.push({ path: p, content: c });
        return ok(undefined);
      },
    });
    const config = makeConfig({ sessionStatePath: "/tmp/test.session" });
    runAgent(config, false, deps);

    const stateWrite = written.find((w) => w.path === "/tmp/test.session");
    expect(stateWrite).toBeDefined();
    expect(stateWrite!.content).toBe("saved-session-789");
  });

  test("falls back to fresh session when resume fails", () => {
    const calls: string[][] = [];
    let callCount = 0;
    const deps = makeDeps({
      env: {},
      readFile: (p) => (p.endsWith(".session") ? ok("stale-session") : err(fileNotFound(p))),
      spawnSyncSafe: (_cmd, args) => {
        calls.push(args);
        callCount++;
        if (callCount === 1) return err(processSpawnFailed("claude", new Error("session expired")));
        return ok({ stdout: '{"session_id":"fallback-session"}', stderr: "", exitCode: 0 });
      },
    });
    const config = makeConfig({ sessionStatePath: "/tmp/test.session" });
    runAgent(config, false, deps);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("--resume");
    expect(calls[1]).not.toContain("--resume");
  });

  test("logs resumed status in completed event", () => {
    const logged: Array<{ path: string; content: string }> = [];
    const deps = makeDeps({
      env: {},
      readFile: (p) => (p.endsWith(".session") ? ok("prev-id") : err(fileNotFound(p))),
      spawnSyncSafe: () => ok({ stdout: '{"session_id":"new-id"}', stderr: "", exitCode: 0 }),
      appendFile: (p, content) => {
        logged.push({ path: p, content });
        return ok(undefined);
      },
    });
    const config = makeConfig({ sessionStatePath: "/tmp/test.session" });
    runAgent(config, false, deps);

    const entry = logged.find((l) => l.content.includes('"completed"'));
    expect(entry).toBeDefined();
    const parsed = JSON.parse(entry!.content.trim());
    expect(parsed.resumed).toBe("true");
  });
});
