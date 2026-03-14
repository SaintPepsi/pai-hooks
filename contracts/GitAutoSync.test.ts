import { describe, it, expect } from "bun:test";
import { GitAutoSync, type GitAutoSyncDeps } from "@hooks/contracts/GitAutoSync";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import { ok } from "@hooks/core/result";

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

  it("skips when index.lock exists (active session using git)", () => {
    const stderrMessages: string[] = [];
    const deps = makeDeps({
      fileExists: (path: string) => path.endsWith("index.lock"),
      stderr: (msg: string) => stderrMessages.push(msg),
    });

    const result = GitAutoSync.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("silent");
    }
    expect(stderrMessages.some(m => m.includes("index.lock exists"))).toBe(true);
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
      expect(result.value.type).toBe("silent");
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

  it("defaultDeps.dateNow returns a number", () => {
    expect(typeof GitAutoSync.defaultDeps.dateNow()).toBe("number");
  });

  it("defaultDeps.fileExists returns a boolean", () => {
    expect(typeof GitAutoSync.defaultDeps.fileExists("/tmp")).toBe("boolean");
  });

  it("defaultDeps.getTimestamp returns a string", () => {
    expect(typeof GitAutoSync.defaultDeps.getTimestamp()).toBe("string");
  });
});
