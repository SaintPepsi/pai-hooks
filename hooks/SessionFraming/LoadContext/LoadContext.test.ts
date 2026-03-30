import { describe, expect, it } from "bun:test";
import { ErrorCode, PaiError } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import type { Result } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import type { ContextOutput, SilentOutput } from "@hooks/core/types/hook-outputs";
import { LoadContext, type LoadContextDeps } from "./LoadContext.contract";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<SessionStartInput> = {}): SessionStartInput {
  return { session_id: "test-session-123", ...overrides };
}

function makeFileReadError(msg = "not found"): Result<never, PaiError> {
  return err(new PaiError(ErrorCode.FileNotFound, msg));
}

function makeFileDirError(msg = "dir not found"): Result<never, PaiError> {
  return err(new PaiError(ErrorCode.FileReadFailed, msg));
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
      }) as Result<T, PaiError>,
    readDir: (_path: string, _opts?: { withFileTypes: true }) =>
      ok([]) as Result<{ name: string; isDirectory(): boolean }[], PaiError>,
    stat: (_path: string) => ok({ mtimeMs: 1000 }),
    execSyncSafe: (_cmd: string, _opts?: { cwd?: string; timeout?: number; stdio?: "pipe" | "ignore" | "inherit" }) => ok("rebuilt"),
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
    expect(result.value.type).toBe("silent");
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
        }) as Result<T, PaiError>,
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("TestPrincipal");
  });

  it("uses DA identity name from settings in context output", async () => {
    const deps = makeDeps({
      readJson: <T = unknown>(_path: string) =>
        ok({
          contextFiles: ["PAI/SKILL.md"],
          principal: { name: "Ian" },
          daidentity: { name: "SpecialDA" },
        }) as Result<T, PaiError>,
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("SpecialDA");
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
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("User");
    expect(result.value.content).toContain("PAI");
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
        err(new PaiError(ErrorCode.JsonParseFailed, "parse error")) as Result<T, PaiError>,
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
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, PaiError>,
      readFile: (path: string) => {
        if (path.includes("SKILL.md")) return ok("# My Skill Content");
        return makeFileReadError();
      },
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("context");
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("My Skill Content");
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
        ok({ contextFiles: ["file-a.md", "file-b.md"] }) as Result<T, PaiError>,
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
        ok({ contextFiles: ["file-a.md", "file-b.md"] }) as Result<T, PaiError>,
      readFile: (path: string) => {
        if (path.includes("file-a.md")) return ok("Content A");
        if (path.includes("file-b.md")) return ok("Content B");
        return makeFileReadError();
      },
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("Content A");
    expect(result.value.content).toContain("Content B");
    expect(result.value.content).toContain("---");
  });

  it("returns silent when no context files are found", async () => {
    const deps = makeDeps({
      fileExists: (_path: string) => false,
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: ["nonexistent.md"] }) as Result<T, PaiError>,
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("silent");
  });
});

// ─── Coding standards loading ─────────────────────────────────────────────────

describe("LoadContext — coding standards", () => {
  it("includes coding standards in output when files exist", async () => {
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("settings.json")) return true;
        if (path.includes("SKILL.md") && !path.includes("CODINGSTANDARDS")) return true;
        if (path.includes("CODINGSTANDARDS")) return true;
        if (path.includes("general.md")) return true;
        if (path.includes("hooks.md")) return true;
        return false;
      },
      readFile: (path: string) => {
        if (path.includes("SKILL.md")) return ok("# Skill");
        if (path.includes("general.md")) return ok("# General Standards");
        if (path.includes("hooks.md")) return ok("# Hooks Standards");
        if (path.includes("skills.md")) return ok("# Skills Standards");
        return makeFileReadError();
      },
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, PaiError>,
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("Coding Standards");
  });

  it("loads general.md and hooks.md but not missing skills.md", async () => {
    const loadedFiles: string[] = [];
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("settings.json")) return true;
        if (path.includes("SKILL.md") && !path.includes("CODINGSTANDARDS")) return true;
        if (path.includes("CODINGSTANDARDS") && !path.includes(".md")) return true;
        if (path.includes("general.md")) return true;
        if (path.includes("hooks.md")) return true;
        if (path.includes("skills.md")) return false;
        return false;
      },
      readFile: (path: string) => {
        loadedFiles.push(path);
        if (path.includes("SKILL.md")) return ok("# Skill");
        if (path.includes("general.md")) return ok("# General");
        if (path.includes("hooks.md")) return ok("# Hooks");
        return makeFileReadError();
      },
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, PaiError>,
    });
    await LoadContext.execute(makeInput(), deps);
    expect(loadedFiles.some((f) => f.includes("general.md"))).toBe(true);
    expect(loadedFiles.some((f) => f.includes("hooks.md"))).toBe(true);
    expect(loadedFiles.some((f) => f.includes("skills.md"))).toBe(false);
  });

  it("omits coding standards section when CODINGSTANDARDS dir is missing", async () => {
    const deps = makeDeps({
      fileExists: (path: string) => {
        if (path.includes("settings.json")) return true;
        if (path.includes("SKILL.md") && !path.includes("CODINGSTANDARDS")) return true;
        if (path.includes("CODINGSTANDARDS")) return false;
        return false;
      },
      readFile: (path: string) => {
        if (path.includes("SKILL.md")) return ok("# Skill content");
        return makeFileReadError();
      },
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, PaiError>,
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.type !== "context") return;
    expect(result.value.content).not.toContain("Coding Standards");
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
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: [] }) as Result<T, PaiError>,
      execSyncSafe: (_cmd: string, _opts?: { cwd?: string; timeout?: number; stdio?: "pipe" | "ignore" | "inherit" }) => {
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
            PaiError
          >;
        }
        return ok([]) as Result<{ name: string; isDirectory(): boolean }[], PaiError>;
      },
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, PaiError>,
      readFile: (path: string) => {
        if (path.includes("SKILL.md")) return ok("# Skill content");
        return makeFileReadError();
      },
      execSyncSafe: (_cmd: string, _opts?: { cwd?: string; timeout?: number; stdio?: "pipe" | "ignore" | "inherit" }) => {
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
            PaiError
          >;
        }
        return ok([]) as Result<{ name: string; isDirectory(): boolean }[], PaiError>;
      },
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, PaiError>,
      readFile: (path: string) => {
        if (path.includes("SKILL.md")) return ok("# Skill content");
        return makeFileReadError();
      },
      execSyncSafe: (_cmd: string, _opts?: { cwd?: string; timeout?: number; stdio?: "pipe" | "ignore" | "inherit" }) => {
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
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: [] }) as Result<T, PaiError>,
      execSyncSafe: (_cmd: string, _opts?: { cwd?: string; timeout?: number; stdio?: "pipe" | "ignore" | "inherit" }) => ok("done"),
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
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: [] }) as Result<T, PaiError>,
      execSyncSafe: (_cmd: string, _opts?: { cwd?: string; timeout?: number; stdio?: "pipe" | "ignore" | "inherit" }) =>
        err(new PaiError(ErrorCode.ProcessExecFailed, "exec failed")),
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
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, PaiError>,
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("They prefer concise responses");
    expect(result.value.content).not.toContain("They dislike verbose output");
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
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, PaiError>,
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.type !== "context") return;
    expect(result.value.content).not.toContain("Low confidence opinion");
    expect(result.value.content).not.toContain("Another low one");
    expect(result.value.content).not.toContain("Relationship Context");
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
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, PaiError>,
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("Relationship Context");
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
            PaiError
          >;
        }
        if (path.includes(dirName)) {
          return ok([makeDirent("META.yaml", false)]) as Result<
            { name: string; isDirectory(): boolean }[],
            PaiError
          >;
        }
        return ok([]) as Result<{ name: string; isDirectory(): boolean }[], PaiError>;
      },
      readFile: (path: string) => {
        if (path.includes("SKILL.md")) return ok("# Skill");
        if (path.includes("META.yaml")) return ok(metaContent);
        return makeFileReadError();
      },
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, PaiError>,
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("ACTIVE WORK");
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
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, PaiError>,
      readFile: (path: string) => {
        if (path.includes("SKILL.md")) return ok("# Skill");
        return makeFileReadError();
      },
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.type !== "context") return;
    expect(result.value.content).not.toContain("ACTIVE WORK");
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
            PaiError
          >;
        }
        return ok([]) as Result<{ name: string; isDirectory(): boolean }[], PaiError>;
      },
      readFile: (path: string) => {
        if (path.includes("SKILL.md")) return ok("# Skill");
        if (path.includes("META.yaml")) return ok(metaContent);
        return makeFileReadError();
      },
      readJson: <T = unknown>(_path: string) =>
        ok({ contextFiles: ["PAI/SKILL.md"] }) as Result<T, PaiError>,
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.type !== "context") return;
    expect(result.value.content).not.toContain("ACTIVE WORK");
  });
});

// ─── Full happy path ──────────────────────────────────────────────────────────

describe("LoadContext — full execute happy path", () => {
  it("returns ContextOutput with type context on success", async () => {
    const deps = makeDeps();
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("context");
  });

  it("includes system-reminder tags in output", async () => {
    const deps = makeDeps();
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("<system-reminder>");
    expect(result.value.content).toContain("</system-reminder>");
  });

  it("includes session ID in output", async () => {
    const deps = makeDeps();
    const result = await LoadContext.execute(makeInput({ session_id: "my-unique-session" }), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("my-unique-session");
  });

  it("includes canary phrase in output", async () => {
    const deps = makeDeps();
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("penguin");
  });

  it("includes current date in output", async () => {
    const deps = makeDeps({
      getCurrentDate: async () => "2026-03-30 09:15:00 AEDT",
    });
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.type !== "context") return;
    expect(result.value.content).toContain("2026-03-30");
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

  it("result type is ContextOutput | SilentOutput — never errors on valid deps", async () => {
    const deps = makeDeps();
    const result = await LoadContext.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(["context", "silent"].includes(result.value.type)).toBe(true);
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
