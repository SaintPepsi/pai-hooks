import { describe, expect, it } from "bun:test";
import { processSpawnFailed } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import {
  type RunArticleWriterDeps,
  runArticleWriter,
} from "@hooks/hooks/WorkLifecycle/ArticleWriter/run-article-writer";
import type { SpawnAgentConfig } from "@hooks/lib/spawn-agent";

// ─── Fake Deps ─────────────────────────────────────────────────────────────

interface SpawnCall {
  cmd: string;
  args: string[];
  opts?: Record<string, unknown>;
}

function fakeDeps(overrides: Partial<RunArticleWriterDeps> = {}): RunArticleWriterDeps & {
  _captured: SpawnAgentConfig[];
  _spawnCalls: SpawnCall[];
} {
  const captured: SpawnAgentConfig[] = [];
  const spawnCalls: SpawnCall[] = [];

  return {
    spawnAgent: (config) => {
      captured.push(config);
      return ok(undefined);
    },
    spawnSyncSafe: (cmd, args, opts) => {
      spawnCalls.push({ cmd, args, opts });
      return ok({ stdout: "", stderr: "", exitCode: 0 });
    },
    fileExists: () => false,
    ensureDir: () => ok(undefined),
    stderr: () => {},
    baseDir: "/fake/pai",
    websiteRepo: "owner/repo",
    cacheDir: "/fake/pai/cache/repos",
    principalName: "Test User",
    daName: "TestDA",
    _captured: captured,
    _spawnCalls: spawnCalls,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("runArticleWriter", () => {
  it("calls spawnAgent with prompt containing the repo path", () => {
    const deps = fakeDeps();
    runArticleWriter("session-123", deps);

    expect(deps._captured.length).toBe(1);
    expect(deps._captured[0].prompt).toContain("/fake/pai/cache/repos/owner/repo");
  });

  it("sets correct lockPath, logPath, and source", () => {
    const deps = fakeDeps();
    runArticleWriter("session-123", deps);

    expect(deps._captured[0].lockPath).toBe("/fake/pai/MEMORY/ARTICLES/.writing");
    expect(deps._captured[0].logPath).toBe("/fake/pai/MEMORY/ARTICLES/article-writer-log.jsonl");
    expect(deps._captured[0].source).toBe("ArticleWriter");
  });

  it("sets reason to session-had-substantial-work", () => {
    const deps = fakeDeps();
    runArticleWriter("session-123", deps);

    expect(deps._captured[0].reason).toBe("session-had-substantial-work");
  });

  it("uses maxTurns 25 and timeout 600000", () => {
    const deps = fakeDeps();
    runArticleWriter("session-123", deps);

    expect(deps._captured[0].maxTurns).toBe(25);
    expect(deps._captured[0].timeout).toBe(600_000);
  });

  it("passes --setting-sources empty via claudeArgs", () => {
    const deps = fakeDeps();
    runArticleWriter("session-123", deps);

    const args = deps._captured[0].claudeArgs ?? [];
    expect(args).toContain("--setting-sources");
    expect(args).toContain("");
  });

  it("resolves cached repo with git fetch when fileExists returns true", () => {
    const deps = fakeDeps({
      fileExists: () => true,
    });
    runArticleWriter("session-123", deps);

    // Should call git fetch, not gh repo clone
    expect(deps._spawnCalls.some((c) => c.cmd === "git" && c.args[0] === "fetch")).toBe(true);
    expect(deps._spawnCalls.some((c) => c.cmd === "gh")).toBe(false);
  });

  it("clones fresh repo when fileExists returns false", () => {
    const deps = fakeDeps({
      fileExists: () => false,
    });
    runArticleWriter("session-123", deps);

    // Should call gh repo clone, not git fetch
    expect(deps._spawnCalls.some((c) => c.cmd === "gh" && c.args[0] === "repo")).toBe(true);
    expect(deps._spawnCalls.some((c) => c.cmd === "git" && c.args[0] === "fetch")).toBe(false);
  });

  it("returns error when clone fails", () => {
    const deps = fakeDeps({
      fileExists: () => false,
      spawnSyncSafe: () => err(processSpawnFailed("gh", new Error("clone failed"))),
    });
    const result = runArticleWriter("session-123", deps);

    expect(result.ok).toBe(false);
    // Should not have called spawnAgent
    expect(deps._captured.length).toBe(0);
  });

  it("passes resolved repo path as cwd to spawnAgent", () => {
    const deps = fakeDeps({
      fileExists: () => true,
    });
    runArticleWriter("session-123", deps);

    expect(deps._captured[0].cwd).toBe("/fake/pai/cache/repos/owner/repo");
  });

  it("returns ok when spawnAgent succeeds", () => {
    const deps = fakeDeps();
    const result = runArticleWriter("session-123", deps);

    expect(result.ok).toBe(true);
  });

  it("returns error when spawnAgent fails", () => {
    const deps = fakeDeps({
      spawnAgent: () => err(processSpawnFailed("claude", new Error("spawn failed"))),
    });
    const result = runArticleWriter("session-123", deps);

    expect(result.ok).toBe(false);
  });

  it("uses model opus", () => {
    const deps = fakeDeps();
    runArticleWriter("session-123", deps);

    expect(deps._captured[0].model).toBe("claude-opus-4-5-20251101");
  });

  it("calls ensureDir for cacheDir before cloning", () => {
    const ensured: string[] = [];
    const deps = fakeDeps({
      fileExists: () => false,
      ensureDir: (path) => {
        ensured.push(path);
        return ok(undefined);
      },
    });
    runArticleWriter("session-123", deps);

    expect(ensured).toContain("/fake/pai/cache/repos");
  });
});
