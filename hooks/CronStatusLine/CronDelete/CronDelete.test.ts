/**
 * CronDelete Contract Tests -- TDD Red phase.
 *
 * Tests the contract in isolation using injected deps (no real filesystem).
 *
 * Covers:
 * 1. accepts() true for CronDelete, false for other tool names
 * 2. Removes cron by ID and keeps other crons
 * 3. Deletes file entirely when last cron removed
 * 4. No-op when session file is missing
 * 5. Logs "deleted" event
 */

import { describe, expect, it } from "bun:test";
import { ErrorCode, ResultError } from "@hooks/core/error";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { CronSessionFile } from "@hooks/hooks/CronStatusLine/shared";
import type { CronDeleteDeps } from "./CronDelete.contract";
import { CronDeleteContract } from "./CronDelete.contract";

// ─── Test Helpers ───────────────────────────────────────────────────────────

interface TestDeps extends CronDeleteDeps {
  _files: Record<string, string>;
  _appendLog: string[];
  _removed: string[];
}

function makeInput(cronId: string, overrides: Partial<ToolHookInput> = {}): ToolHookInput {
  return {
    session_id: "test-session-001",
    tool_name: "CronDelete",
    tool_input: { id: cronId },
    ...overrides,
  };
}

function makeDeps(overrides: Partial<CronDeleteDeps> = {}): TestDeps {
  const files: Record<string, string> = {};
  const appendLog: string[] = [];
  const removed: string[] = [];

  return {
    readFile: (path: string) => {
      if (path in files) return { ok: true as const, value: files[path] };
      return {
        ok: false as const,
        error: new ResultError(ErrorCode.FileNotFound, `File not found: ${path}`),
      };
    },
    writeFile: (path: string, content: string) => {
      files[path] = content;
      return { ok: true as const, value: undefined };
    },
    fileExists: (path: string) => path in files,
    ensureDir: (_path: string) => ({ ok: true as const, value: undefined }),
    readDir: (_path: string) => ({ ok: true as const, value: [] }),
    removeFile: (path: string) => {
      delete files[path];
      removed.push(path);
      return { ok: true as const, value: undefined };
    },
    appendFile: (path: string, content: string) => {
      files[path] = (files[path] || "") + content;
      appendLog.push(content);
      return { ok: true as const, value: undefined };
    },
    stderr: (_msg: string) => {},
    getEnv: (key: string) => {
      if (key === "PAI_DIR") return "/tmp/test-pai";
      if (key === "HOME") return "/tmp";
      return undefined;
    },
    _files: files,
    _appendLog: appendLog,
    _removed: removed,
    ...overrides,
  };
}

function seedSession(deps: TestDeps, session: CronSessionFile): void {
  const path = `/tmp/test-pai/MEMORY/STATE/crons/${session.sessionId}.json`;
  deps._files[path] = JSON.stringify(session);
}

// ─── accepts() ──────────────────────────────────────────────────────────────

describe("CronDeleteContract.accepts()", () => {
  it("returns true for tool_name CronDelete", () => {
    expect(CronDeleteContract.accepts(makeInput("cron-1"))).toBe(true);
  });

  it("returns false for tool_name CronCreate", () => {
    expect(CronDeleteContract.accepts(makeInput("cron-1", { tool_name: "CronCreate" }))).toBe(
      false,
    );
  });

  it("returns false for tool_name Bash", () => {
    expect(CronDeleteContract.accepts(makeInput("cron-1", { tool_name: "Bash" }))).toBe(false);
  });

  it("returns false for tool_name CronFire", () => {
    expect(CronDeleteContract.accepts(makeInput("cron-1", { tool_name: "CronFire" }))).toBe(false);
  });
});

// ─── execute: removes cron by ID, keeps others ─────────────────────────────

describe("CronDeleteContract.execute() -- removes cron by ID", () => {
  it("removes target cron and writes remaining crons back", () => {
    const deps = makeDeps();
    seedSession(deps, {
      sessionId: "test-session-001",
      crons: [
        {
          id: "cron-a",
          name: "alpha",
          schedule: "*/5 * * * *",
          recurring: true,
          prompt: "a",
          createdAt: 1000,
          fireCount: 0,
          lastFired: null,
        },
        {
          id: "cron-b",
          name: "beta",
          schedule: "*/10 * * * *",
          recurring: true,
          prompt: "b",
          createdAt: 2000,
          fireCount: 1,
          lastFired: 3000,
        },
      ],
    });

    const result = CronDeleteContract.execute(makeInput("cron-a"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({});

    // Session file should still exist with only cron-b
    const sessionPath = "/tmp/test-pai/MEMORY/STATE/crons/test-session-001.json";
    expect(deps._files[sessionPath]).toBeDefined();

    const written = JSON.parse(deps._files[sessionPath]) as CronSessionFile;
    expect(written.crons).toHaveLength(1);
    expect(written.crons[0].id).toBe("cron-b");
    expect(written.crons[0].name).toBe("beta");

    // removeFile should NOT have been called
    expect(deps._removed).toHaveLength(0);
  });
});

// ─── execute: deletes file when last cron removed ───────────────────────────

describe("CronDeleteContract.execute() -- deletes file when last cron removed", () => {
  it("calls removeFile instead of writeFile when no crons remain", () => {
    const deps = makeDeps();
    seedSession(deps, {
      sessionId: "test-session-001",
      crons: [
        {
          id: "cron-only",
          name: "lonely",
          schedule: "0 * * * *",
          recurring: false,
          prompt: "x",
          createdAt: 1000,
          fireCount: 0,
          lastFired: null,
        },
      ],
    });

    const result = CronDeleteContract.execute(makeInput("cron-only"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({});

    // removeFile should have been called
    expect(deps._removed).toHaveLength(1);
    expect(deps._removed[0]).toContain("test-session-001.json");

    // Session file should no longer exist in the store
    const sessionPath = "/tmp/test-pai/MEMORY/STATE/crons/test-session-001.json";
    expect(deps._files[sessionPath]).toBeUndefined();
  });
});

// ─── execute: no-op when session file is missing ────────────────────────────

describe("CronDeleteContract.execute() -- no-op when session file missing", () => {
  it("returns silent without any I/O when file does not exist", () => {
    const deps = makeDeps();
    // No seedSession -- file doesn't exist

    const result = CronDeleteContract.execute(makeInput("cron-1"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({});

    // No writes, no removes, no log
    expect(Object.keys(deps._files)).toHaveLength(0);
    expect(deps._removed).toHaveLength(0);
    expect(deps._appendLog).toHaveLength(0);
  });
});

// ─── execute: logs "deleted" event ──────────────────────────────────────────

describe("CronDeleteContract.execute() -- JSONL logging", () => {
  it("logs a 'deleted' event with cron name and session ID", () => {
    const deps = makeDeps();
    seedSession(deps, {
      sessionId: "test-session-001",
      crons: [
        {
          id: "cron-del",
          name: "my-timer",
          schedule: "*/5 * * * *",
          recurring: true,
          prompt: "p",
          createdAt: 1000,
          fireCount: 0,
          lastFired: null,
        },
      ],
    });

    const result = CronDeleteContract.execute(makeInput("cron-del"), deps);
    expect(result.ok).toBe(true);

    expect(deps._appendLog).toHaveLength(1);
    const logEntry = JSON.parse(deps._appendLog[0]);
    expect(logEntry.type).toBe("deleted");
    expect(logEntry.cronId).toBe("cron-del");
    expect(logEntry.name).toBe("my-timer");
    expect(logEntry.sessionId).toBe("test-session-001");
    expect(logEntry.ts).toBeDefined();
  });

  it("does not log when session file is missing (no-op)", () => {
    const deps = makeDeps();
    CronDeleteContract.execute(makeInput("cron-1"), deps);
    expect(deps._appendLog).toHaveLength(0);
  });

  it("does not log when cron ID is not found in session file", () => {
    const deps = makeDeps();
    seedSession(deps, {
      sessionId: "test-session-001",
      crons: [
        {
          id: "cron-exists",
          name: "exists",
          schedule: "0 * * * *",
          recurring: true,
          prompt: "p",
          createdAt: 1000,
          fireCount: 0,
          lastFired: null,
        },
      ],
    });

    const result = CronDeleteContract.execute(makeInput("cron-not-found"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({});

    // No log because nothing was deleted
    expect(deps._appendLog).toHaveLength(0);
    // Session file should be unchanged (original still exists)
    expect(deps._removed).toHaveLength(0);
  });
});

// ─── Contract metadata ──────────────────────────────────────────────────────

describe("CronDeleteContract metadata", () => {
  it("has name CronDelete", () => {
    expect(CronDeleteContract.name).toBe("CronDelete");
  });

  it("has event PostToolUse", () => {
    expect(CronDeleteContract.event).toBe("PostToolUse");
  });
});
