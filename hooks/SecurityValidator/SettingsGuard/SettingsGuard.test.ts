import { describe, expect, it } from "bun:test";
import { ErrorCode, ResultError } from "@hooks/core/error";
import { ok } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  isSettingsPath,
  SettingsGuard,
  type SettingsGuardDeps,
  snapshotPath,
} from "@hooks/hooks/SecurityValidator/SettingsGuard/SettingsGuard.contract";

const HOME = "/Users/testuser";
const SESSION = "test-session-abc";
const ORIGINAL = '{"hooks":{"enabled":true}}';

type FakeFS = Map<string, string>;

function protectorDeps(fs: FakeFS, overrides: Partial<SettingsGuardDeps> = {}): SettingsGuardDeps {
  return {
    homedir: () => HOME,
    stderr: () => {},
    fileExists: (p) => fs.has(p),
    readFile: (p) => {
      const content = fs.get(p);
      if (content === undefined)
        return { ok: false, error: new ResultError(ErrorCode.FileNotFound, p) };
      return ok(content);
    },
    writeFile: (p, c) => {
      fs.set(p, c);
      return ok(undefined as undefined);
    },
    appendFile: (p, c) => {
      const prev = fs.get(p) || "";
      fs.set(p, prev + c);
      return ok(undefined as undefined);
    },
    ensureDir: () => ok(undefined as undefined),
    baseDir: "/fake/pai",
    ...overrides,
  };
}

function settingsInput(tool: string, params: Record<string, unknown>): ToolHookInput {
  return { session_id: SESSION, tool_name: tool, tool_input: params };
}

// ─── isSettingsPath ─────────────────────────────────────────────────────────

describe("isSettingsPath", () => {
  it("matches ~/.claude/settings.json with expanded home", () => {
    expect(isSettingsPath(`${HOME}/.claude/settings.json`, HOME)).toBe(true);
  });

  it("matches ~/.claude/settings.local.json with expanded home", () => {
    expect(isSettingsPath(`${HOME}/.claude/settings.local.json`, HOME)).toBe(true);
  });

  it("matches tilde-prefixed paths", () => {
    expect(isSettingsPath("~/.claude/settings.json", HOME)).toBe(true);
    expect(isSettingsPath("~/.claude/settings.local.json", HOME)).toBe(true);
  });

  it("rejects settings.json in other directories", () => {
    expect(isSettingsPath("/some/project/.claude/settings.json", HOME)).toBe(false);
    expect(isSettingsPath(`${HOME}/projects/foo/settings.json`, HOME)).toBe(false);
  });

  it("rejects non-settings files in ~/.claude/", () => {
    expect(isSettingsPath(`${HOME}/.claude/CLAUDE.md`, HOME)).toBe(false);
  });
});

// ─── snapshotPath ───────────────────────────────────────────────────────────

describe("snapshotPath", () => {
  it("produces deterministic paths", () => {
    const p1 = snapshotPath("sess-1", "settings.json");
    const p2 = snapshotPath("sess-1", "settings.json");
    expect(p1).toBe(p2);
  });

  it("differs by session", () => {
    expect(snapshotPath("a", "settings.json")).not.toBe(snapshotPath("b", "settings.json"));
  });

  it("differs by filename", () => {
    expect(snapshotPath("a", "settings.json")).not.toBe(snapshotPath("a", "settings.local.json"));
  });

  it("sanitises session id", () => {
    const p = snapshotPath("../../etc/passwd", "settings.json");
    expect(p).not.toContain("..");
  });
});

// ─── accepts ────────────────────────────────────────────────────────────────

describe("SettingsGuard.accepts", () => {
  it("has correct name and event", () => {
    expect(SettingsGuard.name).toBe("SettingsGuard");
    expect(SettingsGuard.event).toBe("PreToolUse");
  });

  it("accepts ALL Bash commands (snapshot strategy)", () => {
    expect(SettingsGuard.accepts(settingsInput("Bash", { command: "git status" }))).toBe(true);
    expect(SettingsGuard.accepts(settingsInput("Bash", { command: "echo hello" }))).toBe(true);
  });

  it("accepts Edit targeting settings.json", () => {
    expect(
      SettingsGuard.accepts(settingsInput("Edit", { file_path: `${HOME}/.claude/settings.json` })),
    ).toBe(true);
  });

  it("accepts Write targeting settings.local.json", () => {
    expect(
      SettingsGuard.accepts(
        settingsInput("Write", {
          file_path: `${HOME}/.claude/settings.local.json`,
        }),
      ),
    ).toBe(true);
  });

  it("rejects Read tool", () => {
    expect(
      SettingsGuard.accepts(settingsInput("Read", { file_path: `${HOME}/.claude/settings.json` })),
    ).toBe(false);
  });

  it("rejects Edit to unrelated files", () => {
    expect(
      SettingsGuard.accepts(settingsInput("Edit", { file_path: `${HOME}/project/src/index.ts` })),
    ).toBe(false);
  });

  it("rejects Glob and other tools", () => {
    expect(SettingsGuard.accepts(settingsInput("Glob", { pattern: "*.json" }))).toBe(false);
  });
});

// ─── execute: Edit/Write (ask) ──────────────────────────────────────────────

describe("SettingsGuard.execute — Edit/Write", () => {
  it("returns ask for Edit targeting ~/.claude/settings.json", () => {
    const fs: FakeFS = new Map();
    const result = SettingsGuard.execute(
      settingsInput("Edit", { file_path: `${HOME}/.claude/settings.json` }),
      protectorDeps(fs),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const hs = result.value.hookSpecificOutput;
      expect(hs?.hookEventName).toBe("PreToolUse");
      if (hs && hs.hookEventName === "PreToolUse") {
        expect(hs.permissionDecision).toBe("ask");
        expect(hs.permissionDecisionReason).toContain("Settings Protection");
        expect(hs.permissionDecisionReason).toContain("do NOT suggest workarounds");
      }
    }
  });

  it("returns ask for Write targeting ~/.claude/settings.local.json", () => {
    const fs: FakeFS = new Map();
    const result = SettingsGuard.execute(
      settingsInput("Write", {
        file_path: `${HOME}/.claude/settings.local.json`,
      }),
      protectorDeps(fs),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const hs = result.value.hookSpecificOutput;
      if (hs && hs.hookEventName === "PreToolUse") {
        expect(hs.permissionDecision).toBe("ask");
      } else {
        throw new Error("expected PreToolUse ask permissionDecision");
      }
    }
  });

  it("returns continue for Edit targeting project-level settings.json", () => {
    const fs: FakeFS = new Map();
    const result = SettingsGuard.execute(
      settingsInput("Edit", {
        file_path: "/some/project/.claude/settings.json",
      }),
      protectorDeps(fs),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.continue).toBe(true);
  });
});

// ─── execute: Bash (snapshot) ───────────────────────────────────────────────

describe("SettingsGuard.execute — Bash snapshot", () => {
  it("snapshots settings.json before Bash command", () => {
    const fs: FakeFS = new Map([[`${HOME}/.claude/settings.json`, ORIGINAL]]);
    const result = SettingsGuard.execute(
      settingsInput("Bash", { command: "python3 -c '...'" }),
      protectorDeps(fs),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.continue).toBe(true);

    // Verify snapshot was written
    const snap = fs.get(snapshotPath(SESSION, "settings.json"));
    expect(snap).toBe(ORIGINAL);
  });

  it("snapshots both files when both exist", () => {
    const localContent = '{"respectGitignore":true}';
    const fs: FakeFS = new Map([
      [`${HOME}/.claude/settings.json`, ORIGINAL],
      [`${HOME}/.claude/settings.local.json`, localContent],
    ]);
    SettingsGuard.execute(settingsInput("Bash", { command: "ls" }), protectorDeps(fs));

    expect(fs.get(snapshotPath(SESSION, "settings.json"))).toBe(ORIGINAL);
    expect(fs.get(snapshotPath(SESSION, "settings.local.json"))).toBe(localContent);
  });

  it("skips snapshot for files that dont exist", () => {
    const fs: FakeFS = new Map();
    SettingsGuard.execute(settingsInput("Bash", { command: "echo test" }), protectorDeps(fs));

    expect(fs.has(snapshotPath(SESSION, "settings.json"))).toBe(false);
  });

  it("writes audit log entry on snapshot", () => {
    const fs: FakeFS = new Map([[`${HOME}/.claude/settings.json`, ORIGINAL]]);
    SettingsGuard.execute(
      settingsInput("Bash", { command: "python3 -c '...'" }),
      protectorDeps(fs),
    );

    const logPath = "/fake/pai/MEMORY/SECURITY/settings-audit.jsonl";
    const logContent = fs.get(logPath);
    expect(logContent).toBeDefined();
    const entry = JSON.parse(logContent!.trim());
    expect(entry.action).toBe("snapshotted");
    expect(entry.tool).toBe("Bash");
    expect(entry.session_id).toBe(SESSION);
  });

  it("writes audit log entry on ask", () => {
    const fs: FakeFS = new Map();
    SettingsGuard.execute(
      settingsInput("Edit", { file_path: `${HOME}/.claude/settings.json` }),
      protectorDeps(fs),
    );

    const logPath = "/fake/pai/MEMORY/SECURITY/settings-audit.jsonl";
    const logContent = fs.get(logPath);
    expect(logContent).toBeDefined();
    const entry = JSON.parse(logContent!.trim());
    expect(entry.action).toBe("asked");
    expect(entry.tool).toBe("Edit");
  });

  it("always returns continue for Bash (never blocks)", () => {
    const fs: FakeFS = new Map([[`${HOME}/.claude/settings.json`, ORIGINAL]]);
    const result = SettingsGuard.execute(
      settingsInput("Bash", { command: "some dangerous command" }),
      protectorDeps(fs),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.continue).toBe(true);
  });

  it("warns on stderr when snapshot write fails", () => {
    const messages: string[] = [];
    const fs: FakeFS = new Map([[`${HOME}/.claude/settings.json`, ORIGINAL]]);
    SettingsGuard.execute(
      settingsInput("Bash", { command: "echo test" }),
      protectorDeps(fs, {
        stderr: (msg: string) => messages.push(msg),
        writeFile: () => ({
          ok: false,
          error: new ResultError(ErrorCode.FileWriteFailed, "/tmp/snap"),
        }),
      }),
    );

    expect(messages.some((m) => m.includes("[SettingsGuard] snapshot write failed"))).toBe(true);
  });
});
