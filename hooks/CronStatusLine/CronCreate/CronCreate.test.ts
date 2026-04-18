/**
 * CronCreate Contract Tests -- TDD Red phase.
 *
 * Tests the contract in isolation using injected deps (no real filesystem).
 */

import { describe, expect, it } from "bun:test";
import { ErrorCode, ResultError } from "@hooks/core/error";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { CronSessionFile } from "@hooks/hooks/CronStatusLine/shared";
import type { CronCreateDeps } from "./CronCreate.contract";
import { CronCreateContract } from "./CronCreate.contract";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeInput(overrides: Partial<ToolHookInput> = {}): ToolHookInput {
  return {
    session_id: "test-session-001",
    tool_name: "CronCreate",
    tool_input: {
      schedule: "*/5 * * * *",
      recurring: true,
      prompt: "Check server status",
    },
    tool_response: {
      id: "cron-abc-123",
      humanSchedule: "Every 5 minutes",
    },
    ...overrides,
  };
}

interface TestDeps extends CronCreateDeps {
  _files: Record<string, string>;
  _appendLog: string[];
}

function makeDeps(overrides: Partial<CronCreateDeps> = {}): TestDeps {
  const files: Record<string, string> = {};
  const appendLog: string[] = [];

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
    removeFile: (_path: string) => ({ ok: true as const, value: undefined }),
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
    now: () => 1711324800000, // 2024-03-25T00:00:00Z
    _files: files,
    _appendLog: appendLog,
    ...overrides,
  };
}

// ─── accepts() ──────────────────────────────────────────────────────────────

describe("CronCreateContract.accepts()", () => {
  it("returns true for tool_name CronCreate", () => {
    const input = makeInput({ tool_name: "CronCreate" });
    expect(CronCreateContract.accepts(input)).toBe(true);
  });

  it("returns false for tool_name CronDelete", () => {
    const input = makeInput({ tool_name: "CronDelete" });
    expect(CronCreateContract.accepts(input)).toBe(false);
  });

  it("returns false for tool_name Bash", () => {
    const input = makeInput({ tool_name: "Bash" });
    expect(CronCreateContract.accepts(input)).toBe(false);
  });

  it("returns false for tool_name CronList", () => {
    const input = makeInput({ tool_name: "CronList" });
    expect(CronCreateContract.accepts(input)).toBe(false);
  });
});

// ─── execute() — new session file ───────────────────────────────────────────

describe("CronCreateContract.execute() -- new session file", () => {
  it("creates a new session file when none exists", () => {
    const input = makeInput();
    const deps = makeDeps();
    const result = CronCreateContract.execute(input, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value).toEqual({});

    const sessionPath = "/tmp/test-pai/MEMORY/STATE/crons/test-session-001.json";
    expect(deps._files[sessionPath]).toBeDefined();

    const written = JSON.parse(deps._files[sessionPath]) as CronSessionFile;
    expect(written.sessionId).toBe("test-session-001");
    expect(written.crons).toHaveLength(1);
    expect(written.crons[0].id).toBe("cron-abc-123");
    expect(written.crons[0].name).toBe("Every 5 minutes");
    expect(written.crons[0].schedule).toBe("*/5 * * * *");
    expect(written.crons[0].recurring).toBe(true);
    expect(written.crons[0].prompt).toBe("Check server status");
    expect(written.crons[0].fireCount).toBe(0);
    expect(written.crons[0].lastFired).toBeNull();
  });

  it("uses timestamp as fallback ID when tool_response.id is missing", () => {
    const input = makeInput({ tool_response: {} });
    const deps = makeDeps();
    CronCreateContract.execute(input, deps);

    const sessionPath = "/tmp/test-pai/MEMORY/STATE/crons/test-session-001.json";
    const written = JSON.parse(deps._files[sessionPath]) as CronSessionFile;
    expect(written.crons[0].id).toBe("cron-1711324800000");
  });

  it("uses 'Cron job' as fallback name when humanSchedule is missing", () => {
    const input = makeInput({ tool_response: { id: "cron-xyz" } });
    const deps = makeDeps();
    CronCreateContract.execute(input, deps);

    const sessionPath = "/tmp/test-pai/MEMORY/STATE/crons/test-session-001.json";
    const written = JSON.parse(deps._files[sessionPath]) as CronSessionFile;
    expect(written.crons[0].name).toBe("Cron job");
  });

  it("sets createdAt from deps.now()", () => {
    const input = makeInput();
    const deps = makeDeps({ now: () => 1700000000000 });
    CronCreateContract.execute(input, deps);

    const sessionPath = "/tmp/test-pai/MEMORY/STATE/crons/test-session-001.json";
    const written = JSON.parse(deps._files[sessionPath]) as CronSessionFile;
    expect(written.crons[0].createdAt).toBe(1700000000000);
  });
});

// ─── execute() — existing session file ──────────────────────────────────────

describe("CronCreateContract.execute() -- existing session file", () => {
  it("appends to existing session file with existing crons", () => {
    const existingSession: CronSessionFile = {
      sessionId: "test-session-001",
      crons: [
        {
          id: "cron-existing-1",
          name: "Existing job",
          schedule: "0 * * * *",
          recurring: true,
          prompt: "Do existing thing",
          createdAt: 1700000000000,
          fireCount: 3,
          lastFired: 1700003600000,
        },
      ],
    };

    const sessionPath = "/tmp/test-pai/MEMORY/STATE/crons/test-session-001.json";
    const deps = makeDeps();
    deps._files[sessionPath] = JSON.stringify(existingSession);

    const input = makeInput();
    const result = CronCreateContract.execute(input, deps);

    expect(result.ok).toBe(true);

    const written = JSON.parse(deps._files[sessionPath]) as CronSessionFile;
    expect(written.crons).toHaveLength(2);
    // Existing cron preserved
    expect(written.crons[0].id).toBe("cron-existing-1");
    expect(written.crons[0].fireCount).toBe(3);
    // New cron appended
    expect(written.crons[1].id).toBe("cron-abc-123");
    expect(written.crons[1].fireCount).toBe(0);
    expect(written.crons[1].lastFired).toBeNull();
  });
});

// ─── execute() — duplicate prompt replacement (#244) ────────────────────────

describe("CronCreateContract.execute() -- duplicate prompt replacement", () => {
  it("replaces existing cron with same prompt instead of duplicating (#244)", () => {
    const existingSession: CronSessionFile = {
      sessionId: "test-session-001",
      crons: [
        {
          id: "cron-old",
          name: "Old job",
          schedule: "*/10 * * * *",
          recurring: true,
          prompt: "Check server status", // Same prompt as new cron
          createdAt: 1700000000000,
          fireCount: 5,
          lastFired: 1700003600000,
        },
      ],
    };

    const sessionPath = "/tmp/test-pai/MEMORY/STATE/crons/test-session-001.json";
    const deps = makeDeps();
    deps._files[sessionPath] = JSON.stringify(existingSession);

    const input = makeInput(); // prompt: "Check server status"
    const result = CronCreateContract.execute(input, deps);

    expect(result.ok).toBe(true);

    const written = JSON.parse(deps._files[sessionPath]) as CronSessionFile;
    // Should have only 1 cron (replaced, not duplicated)
    expect(written.crons).toHaveLength(1);
    // The new cron replaced the old one
    expect(written.crons[0].id).toBe("cron-abc-123");
    expect(written.crons[0].schedule).toBe("*/5 * * * *");
    expect(written.crons[0].fireCount).toBe(0); // Reset
  });

  it("logs deleted event when replacing duplicate cron (#244)", () => {
    const existingSession: CronSessionFile = {
      sessionId: "test-session-001",
      crons: [
        {
          id: "cron-old",
          name: "Old job",
          schedule: "*/10 * * * *",
          recurring: true,
          prompt: "Check server status",
          createdAt: 1700000000000,
          fireCount: 5,
          lastFired: 1700003600000,
        },
      ],
    };

    const sessionPath = "/tmp/test-pai/MEMORY/STATE/crons/test-session-001.json";
    const deps = makeDeps();
    deps._files[sessionPath] = JSON.stringify(existingSession);

    const input = makeInput();
    CronCreateContract.execute(input, deps);

    // Should have 2 log entries: deleted (old) + created (new)
    expect(deps._appendLog).toHaveLength(2);

    const deletedLog = JSON.parse(deps._appendLog[0]);
    expect(deletedLog.type).toBe("deleted");
    expect(deletedLog.cronId).toBe("cron-old");

    const createdLog = JSON.parse(deps._appendLog[1]);
    expect(createdLog.type).toBe("created");
    expect(createdLog.cronId).toBe("cron-abc-123");
  });
});

// ─── execute() — JSONL log ──────────────────────────────────────────────────

describe("CronCreateContract.execute() -- JSONL logging", () => {
  it("logs a 'created' event to the JSONL log", () => {
    const input = makeInput();
    const deps = makeDeps();
    CronCreateContract.execute(input, deps);

    expect(deps._appendLog).toHaveLength(1);
    const logLine = JSON.parse(deps._appendLog[0]);
    expect(logLine.type).toBe("created");
    expect(logLine.cronId).toBe("cron-abc-123");
    expect(logLine.name).toBe("Every 5 minutes");
    expect(logLine.schedule).toBe("*/5 * * * *");
    expect(logLine.sessionId).toBe("test-session-001");
    expect(logLine.ts).toBeDefined();
  });
});

// ─── Contract metadata ──────────────────────────────────────────────────────

describe("CronCreateContract metadata", () => {
  it("has name CronCreate", () => {
    expect(CronCreateContract.name).toBe("CronCreate");
  });

  it("has event PostToolUse", () => {
    expect(CronCreateContract.event).toBe("PostToolUse");
  });
});
