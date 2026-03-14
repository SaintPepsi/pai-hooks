import { describe, it, expect } from "bun:test";
import {
  GitAutoSync,
  KEY_HOOK_PATTERN,
  KEY_FILES,
  DEBOUNCE_MINUTES,
  type GitAutoSyncDeps,
} from "@hooks/contracts/GitAutoSync";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import { ok, err } from "@hooks/core/result";
import { PaiError, ErrorCode } from "@hooks/core/error";

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
    claudeDir: "/tmp/test-claude",
    backupDir: "/tmp/test-backup",
    stderr: () => {},
    ...overrides,
  };
}

function makeInput(): SessionEndInput {
  return { session_id: "test" };
}

function execError(msg: string) {
  return err<string, PaiError>(new PaiError(ErrorCode.ProcessExecFailed, msg));
}

// ─── Pipeline Tests ──────────────────────────────────────────────────────────

describe("GitAutoSync pipeline", () => {
  it("returns silent when git status is clean", () => {
    const deps = makeDeps({
      execSync: (cmd: string) => {
        if (cmd === "git status --porcelain") return ok("");
        return ok("");
      },
    });

    const result = GitAutoSync.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("silent");
  });

  it("commits and pushes when status is dirty", () => {
    const commands: string[] = [];
    let pushCalled = false;

    const deps = makeDeps({
      execSync: (cmd: string) => {
        commands.push(cmd);
        if (cmd === "git status --porcelain") return ok("M settings.json\n");
        if (cmd.includes("git log -1")) return ok("");
        if (cmd.includes("git ls-files hooks/")) return ok("");
        return ok("");
      },
      spawnBackground: (cmd: string, args: string[]) => {
        if (cmd === "git" && args[0] === "push") pushCalled = true;
        return ok(undefined);
      },
    });

    GitAutoSync.execute(makeInput(), deps);

    expect(commands).toContain("git add -A");
    expect(commands.some(c => c.includes("git commit"))).toBe(true);
    expect(commands.some(c => c.includes("auto-sync"))).toBe(true);
    expect(pushCalled).toBe(true);
  });

  it("returns silent when last auto-sync is within debounce window", () => {
    const now = Date.now();
    const lastCommitEpoch = Math.floor(now / 1000) - 5 * 60;

    const deps = makeDeps({
      execSync: (cmd: string) => {
        if (cmd === "git status --porcelain") return ok("M file.txt\n");
        if (cmd.includes("git log -1")) return ok(String(lastCommitEpoch));
        return ok("");
      },
      dateNow: () => now,
    });

    const result = GitAutoSync.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("silent");
  });

  it("prints debounce message to stderr", () => {
    const stderrMessages: string[] = [];
    const now = Date.now();
    const lastCommitEpoch = Math.floor(now / 1000) - 5 * 60;

    const deps = makeDeps({
      execSync: (cmd: string) => {
        if (cmd === "git status --porcelain") return ok("M file.txt\n");
        if (cmd.includes("git log -1")) return ok(String(lastCommitEpoch));
        return ok("");
      },
      dateNow: () => now,
      stderr: (msg: string) => { stderrMessages.push(msg); },
    });

    GitAutoSync.execute(makeInput(), deps);
    expect(stderrMessages.some(m => m.includes("Debounced"))).toBe(true);
    expect(stderrMessages.some(m => m.includes(String(DEBOUNCE_MINUTES)))).toBe(true);
  });

  it("proceeds when debounce period has expired", () => {
    const commands: string[] = [];
    const now = Date.now();
    const lastCommitEpoch = Math.floor(now / 1000) - 20 * 60;

    const deps = makeDeps({
      execSync: (cmd: string) => {
        commands.push(cmd);
        if (cmd === "git status --porcelain") return ok("M file.txt\n");
        if (cmd.includes("git log -1")) return ok(String(lastCommitEpoch));
        if (cmd.includes("git ls-files hooks/")) return ok("");
        return ok("");
      },
      dateNow: () => now,
      spawnBackground: () => ok(undefined),
    });

    GitAutoSync.execute(makeInput(), deps);
    expect(commands).toContain("git add -A");
    expect(commands.some(c => c.includes("git commit"))).toBe(true);
  });

  it("cleans up lock on exec error when lock exists", () => {
    let removedPath = "";
    let addAttempted = false;

    const deps = makeDeps({
      execSync: (cmd: string) => {
        if (cmd === "git status --porcelain") return ok("M file.txt\n");
        if (cmd.includes("git log -1")) return ok("");
        if (cmd === "git add -A") { addAttempted = true; return execError("git lock error"); }
        return ok("");
      },
      fileExists: (path: string) => {
        // Lock doesn't exist initially (contract proceeds past isGitBusy)
        // but appears after git add fails (stale lock from failed operation)
        if (path.endsWith("index.lock")) return addAttempted;
        return false;
      },
      removeFile: (path: string) => { removedPath = path; return ok(undefined); },
    });

    GitAutoSync.execute(makeInput(), deps);
    expect(removedPath).toContain("index.lock");
  });

  it("does not remove lock when lock does not exist on error", () => {
    let removeCalled = false;

    const deps = makeDeps({
      execSync: (cmd: string) => {
        if (cmd === "git status --porcelain") return ok("M file.txt\n");
        if (cmd.includes("git log -1")) return ok("");
        if (cmd === "git add -A") return execError("some error");
        return ok("");
      },
      fileExists: () => false,
      removeFile: () => { removeCalled = true; return ok(undefined); },
    });

    GitAutoSync.execute(makeInput(), deps);
    expect(removeCalled).toBe(false);
  });

  it("prints error message to stderr on failure", () => {
    const stderrMessages: string[] = [];

    const deps = makeDeps({
      execSync: (cmd: string) => {
        if (cmd === "git status --porcelain") return ok("M file.txt\n");
        if (cmd.includes("git log -1")) return ok("");
        if (cmd === "git add -A") return execError("test error message");
        return ok("");
      },
      stderr: (msg: string) => { stderrMessages.push(msg); },
    });

    GitAutoSync.execute(makeInput(), deps);
    expect(stderrMessages.some(m => m.includes("test error message"))).toBe(true);
  });

  it("backs up key files before pull", () => {
    const commandOrder: string[] = [];
    let ensureDirCalled = false;
    const copiedDests: string[] = [];

    const deps = makeDeps({
      execSync: (cmd: string) => {
        commandOrder.push(
          cmd.split(" ")[0] +
          (cmd.includes("commit") ? " commit" : cmd.includes("pull") ? " pull" : ""),
        );
        if (cmd === "git status --porcelain") return ok("M settings.json\n");
        if (cmd.includes("git log -1")) return ok("");
        if (cmd.includes("git ls-files hooks/")) return ok("hooks/GitAutoSync.ts\nhooks/other.ts\n");
        return ok("");
      },
      fileExists: (path: string) => {
        for (const f of KEY_FILES) {
          if (path.endsWith(f)) return true;
        }
        if (path.includes("hooks/")) return true;
        return false;
      },
      ensureDir: () => { ensureDirCalled = true; return ok(undefined); },
      copyFile: (_src: string, dest: string) => { copiedDests.push(dest); return ok(undefined); },
      spawnBackground: () => ok(undefined),
    });

    GitAutoSync.execute(makeInput(), deps);

    expect(ensureDirCalled).toBe(true);
    expect(copiedDests.length).toBeGreaterThan(0);
    expect(copiedDests.every(f => f.endsWith(".pre-pull"))).toBe(true);
    const commitIdx = commandOrder.findIndex(c => c.includes("commit"));
    const pullIdx = commandOrder.findIndex(c => c.includes("pull"));
    expect(commitIdx).toBeLessThan(pullIdx);
  });

  it("skips backup when no key files exist", () => {
    let pullExecuted = false;
    let checkDiffCalled = false;

    const deps = makeDeps({
      execSync: (cmd: string) => {
        if (cmd === "git status --porcelain") return ok("M random.txt\n");
        if (cmd.includes("git log -1")) return ok("");
        if (cmd.includes("git ls-files hooks/")) return ok("");
        if (cmd.includes("git pull")) { pullExecuted = true; return ok(""); }
        return ok("");
      },
      fileExists: () => false,
      stderr: (msg: string) => {
        if (msg.includes("WARNING")) checkDiffCalled = true;
      },
      spawnBackground: () => ok(undefined),
    });

    GitAutoSync.execute(makeInput(), deps);
    expect(pullExecuted).toBe(true);
    expect(checkDiffCalled).toBe(false);
  });

  it("warns when files change during merge pull", () => {
    const warnings: string[] = [];

    const deps = makeDeps({
      execSync: (cmd: string) => {
        if (cmd === "git status --porcelain") return ok("M settings.json\n");
        if (cmd.includes("git log -1")) return ok("");
        if (cmd.includes("git ls-files hooks/")) return ok("");
        return ok("");
      },
      fileExists: (path: string) => {
        if (path.endsWith("settings.json")) return true;
        if (path.endsWith(".pre-pull")) return true;
        return false;
      },
      readFile: (path: string) => {
        if (path.includes(".pre-pull")) return ok('{"before": true}');
        return ok('{"after": true}');
      },
      ensureDir: () => ok(undefined),
      copyFile: () => ok(undefined),
      stderr: (msg: string) => { warnings.push(msg); },
      spawnBackground: () => ok(undefined),
    });

    GitAutoSync.execute(makeInput(), deps);
    expect(warnings.some(w => w.includes("WARNING") && w.includes("settings.json"))).toBe(true);
  });

  it("does not warn when files are unchanged after merge pull", () => {
    const warnings: string[] = [];

    const deps = makeDeps({
      execSync: (cmd: string) => {
        if (cmd === "git status --porcelain") return ok("M settings.json\n");
        if (cmd.includes("git log -1")) return ok("");
        if (cmd.includes("git ls-files hooks/")) return ok("");
        return ok("");
      },
      fileExists: (path: string) => {
        if (path.endsWith("settings.json")) return true;
        if (path.endsWith(".pre-pull")) return true;
        return false;
      },
      readFile: () => ok('{"same": true}'),
      ensureDir: () => ok(undefined),
      copyFile: () => ok(undefined),
      stderr: (msg: string) => { warnings.push(msg); },
      spawnBackground: () => ok(undefined),
    });

    GitAutoSync.execute(makeInput(), deps);
    expect(warnings.filter(w => w.includes("WARNING"))).toHaveLength(0);
  });

  it("skips diff check for files not in KEY_FILES or matching KEY_HOOK_PATTERN", () => {
    const warnings: string[] = [];

    const deps = makeDeps({
      execSync: (cmd: string) => {
        if (cmd === "git status --porcelain") return ok("M random.txt\n");
        if (cmd.includes("git log -1")) return ok("");
        if (cmd.includes("git ls-files hooks/")) return ok("not-a-hook.txt\n");
        return ok("");
      },
      fileExists: (path: string) => {
        if (path.endsWith("not-a-hook.txt")) return true;
        if (path.endsWith(".pre-pull")) return true;
        return false;
      },
      readFile: (path: string) => {
        if (path.includes(".pre-pull")) return ok("before");
        return ok("after");
      },
      ensureDir: () => ok(undefined),
      copyFile: () => ok(undefined),
      stderr: (msg: string) => { warnings.push(msg); },
      spawnBackground: () => ok(undefined),
    });

    GitAutoSync.execute(makeInput(), deps);
    expect(warnings.filter(w => w.includes("WARNING"))).toHaveLength(0);
  });

  it("uses timestamp in commit message", () => {
    let commitMsg = "";
    const deps = makeDeps({
      execSync: (cmd: string) => {
        if (cmd === "git status --porcelain") return ok("M file.txt\n");
        if (cmd.includes("git log -1")) return ok("");
        if (cmd.includes("git commit")) commitMsg = cmd;
        if (cmd.includes("git ls-files hooks/")) return ok("");
        return ok("");
      },
      getTimestamp: () => "2026-03-09 17:00:00 AEDT",
      spawnBackground: () => ok(undefined),
    });

    GitAutoSync.execute(makeInput(), deps);
    expect(commitMsg).toContain("2026-03-09 17:00:00 AEDT");
    expect(commitMsg).toContain("auto-sync: session end");
  });
});

// ─── Regex Tests ─────────────────────────────────────────────────────────────

describe("KEY_HOOK_PATTERN regex", () => {
  it("matches .ts files under hooks/", () => {
    expect(KEY_HOOK_PATTERN.test("hooks/GitAutoSync.ts")).toBe(true);
    expect(KEY_HOOK_PATTERN.test("hooks/some-hook.ts")).toBe(true);
  });

  it("matches nested hook paths", () => {
    expect(KEY_HOOK_PATTERN.test("hooks/sub/deep.ts")).toBe(true);
  });

  it("does not match files outside hooks/", () => {
    expect(KEY_HOOK_PATTERN.test("src/GitAutoSync.ts")).toBe(false);
    expect(KEY_HOOK_PATTERN.test("other.ts")).toBe(false);
  });

  it("does not match non-.ts files under hooks/", () => {
    expect(KEY_HOOK_PATTERN.test("hooks/readme.md")).toBe(false);
    expect(KEY_HOOK_PATTERN.test("hooks/config.json")).toBe(false);
  });

  it("requires hooks/ prefix at start of string", () => {
    expect(KEY_HOOK_PATTERN.test("src/hooks/file.ts")).toBe(false);
  });
});
