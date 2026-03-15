import { describe, test, expect } from "bun:test";
import { run, type RunnerDeps } from "@hooks/runners/article-writer-runner";
import { ok, err } from "@hooks/core/result";
import { processSpawnFailed } from "@hooks/core/error";

function makeDeps(overrides: Partial<RunnerDeps> = {}): RunnerDeps {
  return {
    spawnSyncSafe: () => ok({ stdout: "", exitCode: 0 }),
    writeFile: () => ok(undefined),
    removeFile: () => ok(undefined),
    appendFile: () => ok(undefined),
    buildPrompt: () => "test prompt",
    env: { HOME: "/mock/home" },
    websiteRepo: "/mock/Projects/website",
    principalName: "Test User",
    daName: "TestDA",
    stderr: () => {},
    ...overrides,
  };
}

describe("article-writer-runner", () => {
  test("calls spawnSyncSafe with claude command", () => {
    let calledWith: { cmd: string; args: string[] } | null = null;
    const deps = makeDeps({
      spawnSyncSafe: (cmd, args) => {
        calledWith = { cmd, args };
        return ok({ stdout: "", exitCode: 0 });
      },
    });
    run("/base", "session-1", deps);
    expect(calledWith).not.toBeNull();
    expect(calledWith!.cmd).toBe("claude");
    expect(calledWith!.args).toContain("-p");
    expect(calledWith!.args).toContain("--max-turns");
    expect(calledWith!.args).toContain("25");
  });

  test("uses buildPrompt to generate prompt", () => {
    let promptUsed = "";
    const deps = makeDeps({
      buildPrompt: () => "custom-prompt-text",
      spawnSyncSafe: (_cmd, args) => {
        const pIdx = args.indexOf("-p");
        if (pIdx >= 0) promptUsed = args[pIdx + 1];
        return ok({ stdout: "", exitCode: 0 });
      },
    });
    run("/base", "session-1", deps);
    expect(promptUsed).toBe("custom-prompt-text");
  });

  test("writes cooldown file after spawn", () => {
    const written: string[] = [];
    const deps = makeDeps({
      writeFile: (p) => { written.push(p); return ok(undefined); },
    });
    run("/base", "session-1", deps);
    expect(written.some((p) => p.endsWith(".last-article"))).toBe(true);
  });

  test("removes lock file after spawn", () => {
    const removed: string[] = [];
    const deps = makeDeps({
      removeFile: (p) => { removed.push(p); return ok(undefined); },
    });
    run("/base", "session-1", deps);
    expect(removed.some((p) => p.endsWith(".writing"))).toBe(true);
  });

  test("cleanup runs even when spawn fails", () => {
    const written: string[] = [];
    const removed: string[] = [];
    const deps = makeDeps({
      spawnSyncSafe: () => err(processSpawnFailed("claude", new Error("timeout"))),
      writeFile: (p) => { written.push(p); return ok(undefined); },
      removeFile: (p) => { removed.push(p); return ok(undefined); },
    });
    run("/base", "session-1", deps);
    expect(written.some((p) => p.endsWith(".last-article"))).toBe(true);
    expect(removed.some((p) => p.endsWith(".writing"))).toBe(true);
  });

  test("strips CLAUDECODE and sets MAPLE_ARTICLE_AGENT in env", () => {
    let envUsed: Record<string, string | undefined> = {};
    const deps = makeDeps({
      env: { HOME: "/Users/hogers", CLAUDECODE: "true" },
      spawnSyncSafe: (_cmd, _args, opts) => {
        envUsed = (opts?.env || {}) as Record<string, string | undefined>;
        return ok({ stdout: "", exitCode: 0 });
      },
    });
    run("/base", "session-1", deps);
    expect(envUsed.CLAUDECODE).toBeUndefined();
    expect(envUsed.MAPLE_ARTICLE_AGENT).toBe("1");
  });

  test("allows custom command override", () => {
    let cmdUsed = "";
    const deps = makeDeps({
      spawnSyncSafe: (cmd) => { cmdUsed = cmd; return ok({ stdout: "", exitCode: 0 }); },
    });
    run("/base", "session-1", deps, "custom-claude");
    expect(cmdUsed).toBe("custom-claude");
  });

  test("logs START before spawn", () => {
    const logged: string[] = [];
    const deps = makeDeps({
      appendFile: (_p, content) => { logged.push(content as string); return ok(undefined); },
    });
    run("/base", "session-1", deps);
    expect(logged.some((l) => l.includes("START"))).toBe(true);
  });

  test("logs COMPLETE on success", () => {
    const logged: string[] = [];
    const deps = makeDeps({
      appendFile: (_p, content) => { logged.push(content as string); return ok(undefined); },
    });
    run("/base", "session-1", deps);
    expect(logged.some((l) => l.includes("COMPLETE exit=0"))).toBe(true);
  });

  test("logs ERROR on spawn failure", () => {
    const logged: string[] = [];
    const deps = makeDeps({
      spawnSyncSafe: () => err(processSpawnFailed("claude", new Error("timeout"))),
      appendFile: (_p, content) => { logged.push(content as string); return ok(undefined); },
    });
    run("/base", "session-1", deps);
    expect(logged.some((l) => l.includes("ERROR"))).toBe(true);
  });

  test("logs CLEANUP after completion", () => {
    const logged: string[] = [];
    const deps = makeDeps({
      appendFile: (_p, content) => { logged.push(content as string); return ok(undefined); },
    });
    run("/base", "session-1", deps);
    expect(logged.some((l) => l.includes("CLEANUP"))).toBe(true);
  });

  test("writes log to .writing-log file", () => {
    const logPaths: string[] = [];
    const deps = makeDeps({
      appendFile: (p) => { logPaths.push(p); return ok(undefined); },
    });
    run("/base", "session-1", deps);
    expect(logPaths.every((p) => p.endsWith(".writing-log"))).toBe(true);
  });
});
