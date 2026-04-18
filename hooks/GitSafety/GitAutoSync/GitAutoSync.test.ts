import { describe, expect, it } from "bun:test";
import { ErrorCode, ResultError } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import { GitAutoSync, type GitAutoSyncDeps, STALE_LOCK_MINUTES } from "./GitAutoSync.contract";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<GitAutoSyncDeps> = {}): GitAutoSyncDeps {
  return {
    execSync: () => ok(""),
    spawnBackground: () => ok(undefined),
    fileExists: () => false,
    readFile: () => ok(""),
    ensureDir: () => ok(undefined),
    copyFile: () => ok(undefined),
    removeFile: () => ok(undefined),
    readDir: () => ok([]),
    stat: () => ok({ mtimeMs: 0 }),
    dateNow: () => Date.now(),
    getTimestamp: () => "2026-03-09 17:00:00 AEDT",
    claudeDir: "/tmp/test-git-auto-sync",
    backupDir: "/tmp/test-backup",
    stderr: () => {},
    ...overrides,
  };
}

function makeInput(): SessionEndInput {
  return { session_id: "test" };
}

// ─── Contract Tests ──────────────────────────────────────────────────────────

describe("GitAutoSync contract", () => {
  it("has correct name and event", () => {
    expect(GitAutoSync.name).toBe("GitAutoSync");
    expect(GitAutoSync.event).toBe("SessionEnd");
  });

  it("accepts all SessionEnd inputs", () => {
    expect(GitAutoSync.accepts(makeInput())).toBe(true);
  });

  it("skips when index.lock exists and is recent (active session)", () => {
    const now = Date.now();
    const stderrMessages: string[] = [];
    const deps = makeDeps({
      fileExists: (path: string) => path.endsWith("index.lock"),
      stat: () => ok({ mtimeMs: now - 30_000 }), // 30 seconds old — within threshold
      dateNow: () => now,
      stderr: (msg: string) => stderrMessages.push(msg),
    });

    const result = GitAutoSync.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeDefined();
    }
    expect(stderrMessages.some((m) => m.includes("index.lock exists"))).toBe(true);
  });

  it("removes stale index.lock and proceeds with sync", () => {
    const now = Date.now();
    const stderrMessages: string[] = [];
    let lockRemoved = false;
    const deps = makeDeps({
      fileExists: (path: string) => path.endsWith("index.lock"),
      stat: () => ok({ mtimeMs: now - (STALE_LOCK_MINUTES + 1) * 60_000 }), // older than threshold
      dateNow: () => now,
      removeFile: () => {
        lockRemoved = true;
        return ok(undefined);
      },
      stderr: (msg: string) => stderrMessages.push(msg),
      execSync: (cmd: string) => {
        if (cmd === "git status --porcelain") return ok("M settings.json");
        if (cmd.includes("git log")) return ok("");
        return ok("");
      },
    });

    const result = GitAutoSync.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(lockRemoved).toBe(true);
    expect(stderrMessages.some((m) => m.includes("Removing stale index.lock"))).toBe(true);
  });

  it("skips when stat fails on index.lock (assumes active)", () => {
    const stderrMessages: string[] = [];
    const statError: ResultError = new ResultError(ErrorCode.FileReadFailed, "stat failed");
    const deps = makeDeps({
      fileExists: (path: string) => path.endsWith("index.lock"),
      stat: () => err(statError),
      stderr: (msg: string) => stderrMessages.push(msg),
    });

    const result = GitAutoSync.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeDefined();
    }
    expect(stderrMessages.some((m) => m.includes("index.lock exists"))).toBe(true);
  });

  it("proceeds when index.lock does not exist", () => {
    const deps = makeDeps({
      fileExists: () => false,
      execSync: (cmd: string) => {
        if (cmd === "git status --porcelain") return ok("M settings.json");
        if (cmd.includes("git log")) return ok("");
        return ok("");
      },
    });

    const result = GitAutoSync.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
  });

  it("returns silent output when status is clean", () => {
    const deps = makeDeps({
      execSync: (cmd: string) => {
        if (cmd === "git status --porcelain") return ok("");
        return ok("");
      },
    });

    const result = GitAutoSync.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeDefined();
    }
  });
});

// ─── Dependency Tests ────────────────────────────────────────────────────────

describe("GitAutoSync defaultDeps", () => {
  it("defaultDeps.execSync returns error for failed command", () => {
    const result = GitAutoSync.defaultDeps.execSync("false", { timeout: 1000 });
    expect(result.ok).toBe(false);
  });

  it("defaultDeps.spawnBackground returns ok for valid command", () => {
    const result = GitAutoSync.defaultDeps.spawnBackground("echo", ["test"], { cwd: "/tmp" });
    expect(result.ok).toBe(true);
  });

  it("defaultDeps.readFile returns error for missing file", () => {
    const result = GitAutoSync.defaultDeps.readFile("/tmp/nonexistent-pai-test-file-12345.txt");
    expect(result.ok).toBe(false);
  });

  it("defaultDeps.stderr writes without throwing", () => {
    expect(() => GitAutoSync.defaultDeps.stderr("test")).not.toThrow();
  });

  it("defaultDeps.dateNow returns a reasonable timestamp", () => {
    const now = GitAutoSync.defaultDeps.dateNow();
    expect(now).toBeGreaterThan(1700000000000); // After 2023
    expect(now).toBeLessThan(2000000000000); // Before 2033
  });

  it("defaultDeps.fileExists returns true for /tmp", () => {
    expect(GitAutoSync.defaultDeps.fileExists("/tmp")).toBe(true);
  });

  it("defaultDeps.getTimestamp returns ISO-like format", () => {
    const ts = GitAutoSync.defaultDeps.getTimestamp();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}/); // YYYY-MM-DD prefix
  });
});
