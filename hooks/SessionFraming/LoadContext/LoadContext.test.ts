import { describe, expect, it } from "bun:test";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { ErrorCode, ResultError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import { err, ok } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import { LoadContext, type LoadContextDeps, loadWikiPointer } from "./LoadContext.contract";

/** Narrow SyncHookJSONOutput to SessionStart additionalContext (Option B pattern from Gate 1). */
function getInjectedContext(output: SyncHookJSONOutput): string | undefined {
  const hs = output.hookSpecificOutput;
  if (!hs || hs.hookEventName !== "SessionStart") return undefined;
  return hs.additionalContext;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<SessionStartInput> = {}): SessionStartInput {
  return { session_id: "test-session-123", ...overrides };
}

function makeFileReadError(msg = "not found"): Result<never, ResultError> {
  return err(new ResultError(ErrorCode.FileNotFound, msg));
}

function makeFileDirError(msg = "dir not found"): Result<never, ResultError> {
  return err(new ResultError(ErrorCode.FileReadFailed, msg));
}

function makeDirent(name: string, isDir: boolean) {
  return { name, isDirectory: () => isDir };
}

// ─── Default safe deps ────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<LoadContextDeps> = {}): LoadContextDeps {
  return {
    fileExists: (path: string) => {
      if (path.includes("settings.json")) return true;
      if (path.includes("SKILL.md")) return true;
      if (path.includes("CODINGSTANDARDS")) return false;
      if (path.includes("OPINIONS.md")) return false;
      if (path.includes("MEMORY/WORK")) return false;
      if (path.includes("MEMORY/STATE")) return false;
      if (path.includes("MEMORY/RELATIONSHIP")) return false;
      if (path.includes("Components")) return false;
      return false;
    },
    readFile: (_path: string) => ok("# SKILL\n\nContext content."),
    readJson: <T = unknown>(_path: string) =>
      ok({
        contextFiles: ["PAI/SKILL.md"],
        principal: { name: "Ian" },
        daidentity: { name: "Maple" },
      }) as Result<T, ResultError>,
    readDir: (_path: string, _opts?: { withFileTypes: true }) =>
      ok([]) as Result<{ name: string; isDirectory(): boolean }[], ResultError>,
    stat: (_path: string) => ok({ mtimeMs: 1000 }),
    execSyncSafe: (
      _cmd: string,
      _opts?: {
        cwd?: string;
        timeout?: number;
        stdio?: "pipe" | "ignore" | "inherit";
      },
    ) => ok("rebuilt"),
    getDAName: () => "Maple",
    recordSessionStart: () => {},
    getCurrentDate: async () => "2026-03-30 12:00:00 UTC",
    isSubagent: () => false,
    baseDir: "/tmp/test-load-context",
    stderr: () => {},
    ...overrides,
  };
}

// ─── Contract metadata ────────────────────────────────────────────────────────

describe("LoadContext contract metadata", () => {
  it("has correct name", () => {
    expect(LoadContext.name).toBe("LoadContext");
  });

  it("has correct event", () => {
    expect(LoadContext.event).toBe("SessionStart");
  });

  it("accepts all SessionStart inputs", () => {
    expect(LoadContext.accepts(makeInput())).toBe(true);
  });

  it("accepts input with empty session_id", () => {
    expect(LoadContext.accepts({ session_id: "" })).toBe(true);
  });
});

// ─── Subagent path ────────────────────────────────────────────────────────────

describe("LoadContext — subagent path", () => {
  it("returns silent output when isSubagent returns true", async () => {
    const deps = makeDeps({ isSubagent: () => true });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getInjectedContext(result.value)).toBeUndefined();
    expect(result.value.continue).toBeUndefined();
  });

  it("does not call recordSessionStart for subagents", async () => {
    let called = false;
    const deps = makeDeps({
      isSubagent: () => true,
      recordSessionStart: () => {
        called = true;
      },
    });
    await LoadContext.execute(makeInput(), deps);
    expect(called).toBe(false);
  });

  it("does not call getCurrentDate for subagents", async () => {
    let called = false;
    const deps = makeDeps({
      isSubagent: () => true,
      getCurrentDate: async () => {
        called = true;
        return "2026-03-30";
      },
    });
    await LoadContext.execute(makeInput(), deps);
    expect(called).toBe(false);
  });
});

// ─── Settings loading ─────────────────────────────────────────────────────────

describe("LoadContext — settings loading", () => {
  it("uses principal name from settings in context output", async () => {
    const deps = makeDeps({
      readJson: <T = unknown>(_path: string) =>
        ok({
          contextFiles: ["PAI/SKILL.md"],
          principal: { name: "TestPrincipal" },
          daidentity: { name: "Maple" },
        }) as Result<T, ResultError>,
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = getInjectedContext(result.value);
    expect(ctx).toBeDefined();
    expect(ctx ?? "").toContain("TestPrincipal");
  });

  it("uses DA identity name from settings in context output", async () => {
    const deps = makeDeps({
      readJson: <T = unknown>(_path: string) =>
        ok({
          contextFiles: ["PAI/SKILL.md"],
          principal: { name: "Ian" },
          daidentity: { name: "SpecialDA" },
        }) as Result<T, ResultError>,
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = getInjectedContext(result.value);
    expect(ctx).toBeDefined();
    expect(ctx ?? "").toContain("SpecialDA");
  });

  it("falls back to 'User' and 'PAI' when settings.json is missing", async () => {
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("settings.json")) return false;
        if (path.includes("SKILL.md")) return true;
        return false;
      },
      // contextFiles falls back to defaults: PAI/SKILL.md, PAI/AISTEERINGRULES.md, etc.
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = getInjectedContext(result.value);
    expect(ctx).toBeDefined();
    expect(ctx ?? "").toContain("User");
    expect(ctx ?? "").toContain("PAI");
  });

  it("falls back to defaults when readJson fails on settings.json", async () => {
    const stderrMessages: string[] = [];
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("settings.json")) return true;
        if (path.includes("SKILL.md")) return true;
        return false;
      },
      readJson: <T = unknown>(_path: string) =>
        err(new ResultError(ErrorCode.JsonParseFailed, "parse error")) as Result<T, ResultError>,
      readFile: (path: string) => {
        if (path.includes("SKILL.md")) return ok("# SKILL content");
        return makeFileReadError();
      },
      stderr: (msg: string) => {
        stderrMessages.push(msg);
      },
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    // Should still log error but continue
    expect(stderrMessages.some((m) => m.includes("settings.json"))).toBe(true);
  });
});

// ─── Context files loading ────────────────────────────────────────────────────

describe("LoadContext — context files loading", () => {
  it("loads context files listed in settings and includes content", async () => {
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("settings.json")) return true;
        if (path.includes("SKILL.md")) return true;
        return false;
      },
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, ResultError>,
      readFile: (path: string) => {
        if (path.includes("SKILL.md")) return ok("# My Skill Content");
        return makeFileReadError();
      },
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = getInjectedContext(result.value);
    expect(ctx).toBeDefined();
    expect(ctx ?? "").toContain("My Skill Content");
  });

  it("logs skip message for missing context files", async () => {
    const stderrMessages: string[] = [];
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("settings.json")) return true;
        if (path.includes("file-a.md")) return true;
        if (path.includes("file-b.md")) return false;
        return false;
      },
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: ["file-a.md", "file-b.md"] }) as Result<T, ResultError>,
      readFile: (path: string) => {
        if (path.includes("file-a.md")) return ok("Content A");
        return makeFileReadError();
      },
      stderr: (msg: string) => {
        stderrMessages.push(msg);
      },
    });
    await LoadContext.execute(makeInput(), deps);
    expect(stderrMessages.some((m) => m.includes("not found"))).toBe(true);
  });

  it("joins multiple context files with separator", async () => {
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("settings.json")) return true;
        if (path.includes("file-a.md")) return true;
        if (path.includes("file-b.md")) return true;
        return false;
      },
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: ["file-a.md", "file-b.md"] }) as Result<T, ResultError>,
      readFile: (path: string) => {
        if (path.includes("file-a.md")) return ok("Content A");
        if (path.includes("file-b.md")) return ok("Content B");
        return makeFileReadError();
      },
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = getInjectedContext(result.value);
    expect(ctx).toBeDefined();
    expect(ctx ?? "").toContain("Content A");
    expect(ctx ?? "").toContain("Content B");
    expect(ctx ?? "").toContain("---");
  });

  it("returns silent when no context files are found", async () => {
    const deps = makeDeps({
      fileExists: (_path: string) => false,
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: ["nonexistent.md"] }) as Result<T, ResultError>,
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getInjectedContext(result.value)).toBeUndefined();
    expect(result.value.continue).toBeUndefined();
  });
});

// ─── Skill rebuild ────────────────────────────────────────────────────────────

describe("LoadContext — needsSkillRebuild", () => {
  it("triggers rebuild when SKILL.md does not exist", async () => {
    let rebuiltCalled = false;
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("settings.json")) return true;
        if (path.includes("SKILL.md")) return false; // does not exist
        return false;
      },
      readJson: <T = unknown>(_path: string) => ok({ contextFiles: [] }) as Result<T, ResultError>,
      execSyncSafe: (
        _cmd: string,
        _opts?: {
          cwd?: string;
          timeout?: number;
          stdio?: "pipe" | "ignore" | "inherit";
        },
      ) => {
        rebuiltCalled = true;
        return ok("rebuilt");
      },
    });
    await LoadContext.execute(makeInput(), deps);
    expect(rebuiltCalled).toBe(true);
  });

  it("triggers rebuild when a component file is newer than SKILL.md", async () => {
    let rebuiltCalled = false;
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("settings.json")) return true;
        if (path.includes("SKILL.md")) return true;
        if (path.includes("Components")) return true;
        return false;
      },
      stat: (path: string) => {
        if (path.includes("SKILL.md")) return ok({ mtimeMs: 1000 });
        if (path.includes("component.md")) return ok({ mtimeMs: 2000 }); // newer
        return ok({ mtimeMs: 500 });
      },
      readDir: (path: string, _opts?: { withFileTypes: true }) => {
        if (path.includes("Components")) {
          return ok([makeDirent("component.md", false)]) as Result<
            { name: string; isDirectory(): boolean }[],
            ResultError
          >;
        }
        return ok([]) as Result<{ name: string; isDirectory(): boolean }[], ResultError>;
      },
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, ResultError>,
      readFile: (path: string) => {
        if (path.includes("SKILL.md")) return ok("# Skill content");
        return makeFileReadError();
      },
      execSyncSafe: (
        _cmd: string,
        _opts?: {
          cwd?: string;
          timeout?: number;
          stdio?: "pipe" | "ignore" | "inherit";
        },
      ) => {
        rebuiltCalled = true;
        return ok("rebuilt");
      },
    });
    await LoadContext.execute(makeInput(), deps);
    expect(rebuiltCalled).toBe(true);
  });

  it("does not trigger rebuild when SKILL.md is newer than all components", async () => {
    let rebuiltCalled = false;
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("settings.json")) return true;
        if (path.includes("SKILL.md")) return true;
        if (path.includes("Components")) return true;
        return false;
      },
      stat: (path: string) => {
        if (path.includes("SKILL.md")) return ok({ mtimeMs: 9999 }); // newest
        return ok({ mtimeMs: 500 });
      },
      readDir: (path: string, _opts?: { withFileTypes: true }) => {
        if (path.includes("Components")) {
          return ok([makeDirent("old-component.md", false)]) as Result<
            { name: string; isDirectory(): boolean }[],
            ResultError
          >;
        }
        return ok([]) as Result<{ name: string; isDirectory(): boolean }[], ResultError>;
      },
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, ResultError>,
      readFile: (path: string) => {
        if (path.includes("SKILL.md")) return ok("# Skill content");
        return makeFileReadError();
      },
      execSyncSafe: (
        _cmd: string,
        _opts?: {
          cwd?: string;
          timeout?: number;
          stdio?: "pipe" | "ignore" | "inherit";
        },
      ) => {
        rebuiltCalled = true;
        return ok("rebuilt");
      },
    });
    await LoadContext.execute(makeInput(), deps);
    expect(rebuiltCalled).toBe(false);
  });

  it("logs rebuild success message when exec succeeds", async () => {
    const stderrMessages: string[] = [];
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("SKILL.md")) return false;
        if (path.includes("settings.json")) return true;
        return false;
      },
      readJson: <T = unknown>(_path: string) => ok({ contextFiles: [] }) as Result<T, ResultError>,
      execSyncSafe: (
        _cmd: string,
        _opts?: {
          cwd?: string;
          timeout?: number;
          stdio?: "pipe" | "ignore" | "inherit";
        },
      ) => ok("done"),
      stderr: (msg: string) => {
        stderrMessages.push(msg);
      },
    });
    await LoadContext.execute(makeInput(), deps);
    expect(stderrMessages.some((m) => m.includes("rebuilt"))).toBe(true);
  });

  it("logs failure message and continues when exec fails", async () => {
    const stderrMessages: string[] = [];
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("SKILL.md")) return false;
        if (path.includes("settings.json")) return true;
        return false;
      },
      readJson: <T = unknown>(_path: string) => ok({ contextFiles: [] }) as Result<T, ResultError>,
      execSyncSafe: (
        _cmd: string,
        _opts?: {
          cwd?: string;
          timeout?: number;
          stdio?: "pipe" | "ignore" | "inherit";
        },
      ) => err(new ResultError(ErrorCode.ProcessExecFailed, "exec failed")),
      stderr: (msg: string) => {
        stderrMessages.push(msg);
      },
    });
    const result = await LoadContext.execute(makeInput(), deps);
    // Should not crash; continues with whatever exists
    expect(result.ok).toBe(true);
    expect(stderrMessages.some((m) => m.includes("Failed") || m.includes("failed"))).toBe(true);
  });
});

// ─── Relationship context ─────────────────────────────────────────────────────

describe("LoadContext — relationship context", () => {
  it("includes high-confidence opinions (>= 0.85) in output", async () => {
    const opinionsContent = `
### They prefer concise responses
**Confidence:** 0.90
Some details.

### They dislike verbose output
**Confidence:** 0.70
Below threshold.
`;
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("settings.json")) return true;
        if (path.includes("SKILL.md") && !path.includes("CODINGSTANDARDS")) return true;
        if (path.includes("OPINIONS.md")) return true;
        return false;
      },
      readFile: (path: string) => {
        if (path.includes("SKILL.md")) return ok("# Skill");
        if (path.includes("OPINIONS.md")) return ok(opinionsContent);
        return makeFileReadError();
      },
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, ResultError>,
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = getInjectedContext(result.value);
    expect(ctx).toBeDefined();
    expect(ctx ?? "").toContain("They prefer concise responses");
    expect(ctx ?? "").not.toContain("They dislike verbose output");
  });

  it("excludes opinions below 0.85 confidence threshold", async () => {
    const opinionsContent = `
### Low confidence opinion
**Confidence:** 0.50
Not very sure.

### Another low one
**Confidence:** 0.84
Just below threshold.
`;
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("settings.json")) return true;
        if (path.includes("SKILL.md") && !path.includes("CODINGSTANDARDS")) return true;
        if (path.includes("OPINIONS.md")) return true;
        return false;
      },
      readFile: (path: string) => {
        if (path.includes("SKILL.md")) return ok("# Skill");
        if (path.includes("OPINIONS.md")) return ok(opinionsContent);
        return makeFileReadError();
      },
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, ResultError>,
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = getInjectedContext(result.value);
    expect(ctx).toBeDefined();
    expect(ctx ?? "").not.toContain("Low confidence opinion");
    expect(ctx ?? "").not.toContain("Another low one");
    expect(ctx ?? "").not.toContain("Relationship Context");
  });

  it("includes relationship context section header when opinions are high confidence", async () => {
    const opinionsContent = `
### Strong preference detected
**Confidence:** 0.95
Very confident.
`;
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("settings.json")) return true;
        if (path.includes("SKILL.md") && !path.includes("CODINGSTANDARDS")) return true;
        if (path.includes("OPINIONS.md")) return true;
        return false;
      },
      readFile: (path: string) => {
        if (path.includes("SKILL.md")) return ok("# Skill");
        if (path.includes("OPINIONS.md")) return ok(opinionsContent);
        return makeFileReadError();
      },
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, ResultError>,
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = getInjectedContext(result.value);
    expect(ctx).toBeDefined();
    expect(ctx ?? "").toContain("Relationship Context");
  });
});

// ─── Work sessions ────────────────────────────────────────────────────────────

describe("LoadContext — work sessions", () => {
  it("includes recent work sessions in active work summary", async () => {
    // Use a timestamp that's always recent (within 48h cutoff)
    const now = new Date();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const h = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    const s = String(now.getSeconds()).padStart(2, "0");
    const dirName = `${y}${mo}${d}-${h}${mi}${s}_my-active-task`;
    const metaContent = `status: ACTIVE\ntitle: My Active Task Title That Is Long Enough\n`;

    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("settings.json")) return true;
        if (path.includes("SKILL.md") && !path.includes("CODINGSTANDARDS")) return true;
        if (path.includes("MEMORY/WORK") && !path.includes(dirName)) return true;
        if (path.includes(dirName)) return true;
        if (path.includes("META.yaml")) return true;
        if (path.includes("session-names.json")) return false;
        return false;
      },
      readDir: (path: string, _opts?: { withFileTypes: true }) => {
        if (path.includes("MEMORY/WORK")) {
          return ok([makeDirent(dirName, true)]) as Result<
            { name: string; isDirectory(): boolean }[],
            ResultError
          >;
        }
        if (path.includes(dirName)) {
          return ok([makeDirent("META.yaml", false)]) as Result<
            { name: string; isDirectory(): boolean }[],
            ResultError
          >;
        }
        return ok([]) as Result<{ name: string; isDirectory(): boolean }[], ResultError>;
      },
      readFile: (path: string) => {
        if (path.includes("SKILL.md")) return ok("# Skill");
        if (path.includes("META.yaml")) return ok(metaContent);
        return makeFileReadError();
      },
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, ResultError>,
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = getInjectedContext(result.value);
    expect(ctx).toBeDefined();
    expect(ctx ?? "").toContain("ACTIVE WORK");
  });

  it("omits active work section when no recent work sessions exist", async () => {
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("settings.json")) return true;
        if (path.includes("SKILL.md") && !path.includes("CODINGSTANDARDS")) return true;
        if (path.includes("MEMORY/WORK")) return false;
        return false;
      },
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, ResultError>,
      readFile: (path: string) => {
        if (path.includes("SKILL.md")) return ok("# Skill");
        return makeFileReadError();
      },
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = getInjectedContext(result.value);
    expect(ctx).toBeDefined();
    expect(ctx ?? "").not.toContain("ACTIVE WORK");
  });

  it("skips COMPLETED sessions from work summary", async () => {
    const now = new Date();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const h = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    const s = String(now.getSeconds()).padStart(2, "0");
    const dirName = `${y}${mo}${d}-${h}${mi}${s}_completed-task-with-long-name`;
    const metaContent = `status: COMPLETED\ntitle: Completed Task With Long Enough Title\n`;

    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("settings.json")) return true;
        if (path.includes("SKILL.md") && !path.includes("CODINGSTANDARDS")) return true;
        if (path.includes("MEMORY/WORK") && !path.includes(dirName)) return true;
        if (path.includes(dirName)) return true;
        if (path.includes("META.yaml")) return true;
        return false;
      },
      readDir: (path: string, _opts?: { withFileTypes: true }) => {
        if (path.includes("MEMORY/WORK")) {
          return ok([makeDirent(dirName, true)]) as Result<
            { name: string; isDirectory(): boolean }[],
            ResultError
          >;
        }
        return ok([]) as Result<{ name: string; isDirectory(): boolean }[], ResultError>;
      },
      readFile: (path: string) => {
        if (path.includes("SKILL.md")) return ok("# Skill");
        if (path.includes("META.yaml")) return ok(metaContent);
        return makeFileReadError();
      },
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, ResultError>,
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = getInjectedContext(result.value);
    expect(ctx).toBeDefined();
    expect(ctx ?? "").not.toContain("ACTIVE WORK");
  });
});

// ─── Full happy path ──────────────────────────────────────────────────────────

describe("LoadContext — full execute happy path", () => {
  it("returns SyncHookJSONOutput with SessionStart additionalContext on success", async () => {
    const deps = makeDeps();
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getInjectedContext(result.value)).toBeDefined();
    expect(result.value.continue).toBe(true);
  });

  it("includes system-reminder tags in output", async () => {
    const deps = makeDeps();
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = getInjectedContext(result.value);
    expect(ctx).toBeDefined();
    expect(ctx ?? "").toContain("<system-reminder>");
    expect(ctx ?? "").toContain("</system-reminder>");
  });

  it("includes session ID in output", async () => {
    const deps = makeDeps();
    const result = await LoadContext.execute(makeInput({ session_id: "my-unique-session" }), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = getInjectedContext(result.value);
    expect(ctx).toBeDefined();
    expect(ctx ?? "").toContain("my-unique-session");
  });

  it("includes canary phrase in output", async () => {
    const deps = makeDeps();
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = getInjectedContext(result.value);
    expect(ctx).toBeDefined();
    expect(ctx ?? "").toContain("penguin");
  });

  it("includes current date in output", async () => {
    const deps = makeDeps({
      getCurrentDate: async () => "2026-03-30 09:15:00 AEDT",
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ctx = getInjectedContext(result.value);
    expect(ctx).toBeDefined();
    expect(ctx ?? "").toContain("2026-03-30");
  });

  it("calls recordSessionStart during execute", async () => {
    let called = false;
    const deps = makeDeps({
      recordSessionStart: () => {
        called = true;
      },
    });
    await LoadContext.execute(makeInput(), deps);
    expect(called).toBe(true);
  });

  it("result is SyncHookJSONOutput — never errors on valid deps", async () => {
    const deps = makeDeps();
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Either context injection (happy path) or silent ({})
      const hasContext = getInjectedContext(result.value) !== undefined;
      const isSilent = result.value.continue === undefined && !result.value.hookSpecificOutput;
      expect(hasContext || isSilent).toBe(true);
    }
  });
});

// ─── defaultDeps smoke tests ──────────────────────────────────────────────────

describe("LoadContext defaultDeps", () => {
  it("defaultDeps.isSubagent returns a boolean", () => {
    expect(typeof LoadContext.defaultDeps.isSubagent()).toBe("boolean");
  });

  it("defaultDeps.getDAName returns a string", () => {
    expect(typeof LoadContext.defaultDeps.getDAName()).toBe("string");
  });

  it("defaultDeps.stderr does not throw", () => {
    expect(() => LoadContext.defaultDeps.stderr("test message")).not.toThrow();
  });

  it("defaultDeps.baseDir is a non-empty string", () => {
    expect(typeof LoadContext.defaultDeps.baseDir).toBe("string");
    expect(LoadContext.defaultDeps.baseDir.length).toBeGreaterThan(0);
  });
});

// ─── Wiki pointer ────────────────────────────────────────────────────────────

describe("loadWikiPointer", () => {
  it("returns null when wiki index does not exist", () => {
    const deps = makeDeps({ fileExists: () => false });
    expect(loadWikiPointer("/base", deps)).toBeNull();
  });

  it("returns null when wiki has no pages", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readDir: () => ok([]) as Result<{ name: string; isDirectory(): boolean }[], ResultError>,
    });
    expect(loadWikiPointer("/base", deps)).toBeNull();
  });

  it("returns pointer with page count across all subdirs", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readDir: () =>
        ok([makeDirent("koord.md", false), makeDirent("bun.md", false)]) as Result<
          { name: string; isDirectory(): boolean }[],
          ResultError
        >,
    });
    const result = loadWikiPointer("/base", deps);
    expect(result).toContain("6"); // 2 per subdir × 3 subdirs
    expect(result).toContain("knowledge pages");
  });

  it("only counts .md files", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readDir: () =>
        ok([
          makeDirent("page.md", false),
          makeDirent(".DS_Store", false),
          makeDirent("subdir", true),
        ]) as Result<{ name: string; isDirectory(): boolean }[], ResultError>,
    });
    const result = loadWikiPointer("/base", deps);
    expect(result).toContain("3"); // 1 .md per subdir × 3 subdirs
    expect(result).toContain("MEMORY/WIKI/index.md");
  });

  it("handles readDir failure gracefully", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readDir: () => makeFileDirError("not found"),
    });
    expect(loadWikiPointer("/base", deps)).toBeNull();
  });
});
