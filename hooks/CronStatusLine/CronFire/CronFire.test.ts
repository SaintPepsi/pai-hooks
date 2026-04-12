/**
 * CronFire Contract Tests — TDD Red phase.
 *
 * Covers:
 * 1. accepts() always returns true
 * 2. Increments fireCount and sets lastFired on matching prompt
 * 3. Does NOT write when prompt doesn't match any cron
 * 4. No-op when no cron file exists for session
 * 5. No-op when prompt is empty/undefined
 * 6. Only updates matched cron, leaves others unchanged
 */

import { describe, expect, it } from "bun:test";
import { ErrorCode, ResultError } from "@hooks/core/error";
import type { UserPromptSubmitInput } from "@hooks/core/types/hook-inputs";
import type { CronSessionFile } from "@hooks/hooks/CronStatusLine/shared";
import type { CronFireDeps } from "./CronFire.contract";
import { CronFireContract } from "./CronFire.contract";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeInput(
  prompt?: string,
  overrides: Partial<UserPromptSubmitInput> = {},
): UserPromptSubmitInput {
  return {
    session_id: "test-session-001",
    prompt,
    ...overrides,
  };
}

function makeCron(
  overrides: Partial<CronSessionFile["crons"][0]> = {},
): CronSessionFile["crons"][0] {
  return {
    id: "cron-1",
    name: "Test Cron",
    schedule: "every 5 minutes",
    recurring: true,
    prompt: "run the tests",
    createdAt: 1000000,
    fireCount: 0,
    lastFired: null,
    ...overrides,
  };
}

interface TestDeps extends CronFireDeps {
  _files: Record<string, string>;
  _appendLog: string[];
}

function makeDeps(overrides: Partial<CronFireDeps> = {}): TestDeps {
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
    now: () => 2000000,
    _files: files,
    _appendLog: appendLog,
    ...overrides,
  };
}

/** Seed a session cron file into the in-memory filesystem. */
function seedCronFile(deps: TestDeps, crons: CronSessionFile["crons"]): void {
  const sessionFile: CronSessionFile = { sessionId: "test-session-001", crons };
  const path = "/tmp/test-pai/MEMORY/STATE/crons/test-session-001.json";
  deps._files[path] = JSON.stringify(sessionFile);
}

/** Read the written session file from the in-memory filesystem. */
function readWrittenFile(deps: TestDeps): CronSessionFile {
  const path = "/tmp/test-pai/MEMORY/STATE/crons/test-session-001.json";
  return JSON.parse(deps._files[path]) as CronSessionFile;
}

// ─── accepts() ──────────────────────────────────────────────────────────────

describe("CronFireContract.accepts()", () => {
  it("returns true for any input", () => {
    expect(CronFireContract.accepts(makeInput("anything"))).toBe(true);
    expect(CronFireContract.accepts(makeInput(""))).toBe(true);
    expect(CronFireContract.accepts(makeInput(undefined))).toBe(true);
    expect(CronFireContract.accepts(makeInput("run the tests"))).toBe(true);
  });
});

// ─── No-op: empty/undefined prompt ──────────────────────────────────────────

describe("CronFireContract.execute() — empty/undefined prompt", () => {
  it("returns silent when prompt is undefined", () => {
    const deps = makeDeps();
    seedCronFile(deps, [makeCron()]);
    const result = CronFireContract.execute(makeInput(undefined), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({});
    expect(deps._appendLog).toHaveLength(0);
  });

  it("returns silent when prompt is empty string", () => {
    const deps = makeDeps();
    seedCronFile(deps, [makeCron()]);
    const result = CronFireContract.execute(makeInput(""), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({});
    expect(deps._appendLog).toHaveLength(0);
  });
});

// ─── No-op: no cron file ────────────────────────────────────────────────────

describe("CronFireContract.execute() — no cron file", () => {
  it("returns silent when session cron file does not exist", () => {
    const deps = makeDeps();
    // Do NOT seed any cron file — file does not exist
    const result = CronFireContract.execute(makeInput("run the tests"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({});
    expect(deps._appendLog).toHaveLength(0);
  });
});

// ─── No match ───────────────────────────────────────────────────────────────

describe("CronFireContract.execute() — no matching cron", () => {
  it("returns silent and does NOT write when prompt matches no cron", () => {
    const deps = makeDeps();
    seedCronFile(deps, [
      makeCron({ id: "cron-1", prompt: "deploy to production" }),
      makeCron({ id: "cron-2", prompt: "run migrations" }),
    ]);

    const fileBeforeExec = deps._files["/tmp/test-pai/MEMORY/STATE/crons/test-session-001.json"];
    const result = CronFireContract.execute(makeInput("something completely different"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({});
    // File content should be unchanged (no write happened)
    expect(deps._files["/tmp/test-pai/MEMORY/STATE/crons/test-session-001.json"]).toBe(
      fileBeforeExec,
    );
    expect(deps._appendLog).toHaveLength(0);
  });
});

// ─── Match: fire detection ──────────────────────────────────────────────────

describe("CronFireContract.execute() — matching cron", () => {
  it("increments fireCount and sets lastFired on matched cron", () => {
    const deps = makeDeps({ now: () => 9999999 });
    seedCronFile(deps, [
      makeCron({
        id: "cron-1",
        prompt: "run the tests",
        fireCount: 2,
        lastFired: 1500000,
      }),
    ]);

    const result = CronFireContract.execute(makeInput("run the tests"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({});

    const written = readWrittenFile(deps);
    expect(written.crons[0].fireCount).toBe(3);
    expect(written.crons[0].lastFired).toBe(9999999);
  });

  it("appends a 'fired' event to the JSONL log", () => {
    const deps = makeDeps();
    seedCronFile(deps, [
      makeCron({
        id: "cron-1",
        name: "Test Cron",
        prompt: "run the tests",
        fireCount: 0,
      }),
    ]);

    CronFireContract.execute(makeInput("run the tests"), deps);

    expect(deps._appendLog).toHaveLength(1);
    const logLine = JSON.parse(deps._appendLog[0]);
    expect(logLine.type).toBe("fired");
    expect(logLine.cronId).toBe("cron-1");
    expect(logLine.name).toBe("Test Cron");
    expect(logLine.fireCount).toBe(1);
    expect(logLine.ts).toBeDefined();
  });

  it("matches when prompt contains cron prompt as substring", () => {
    const deps = makeDeps();
    seedCronFile(deps, [makeCron({ prompt: "run the tests" })]);

    const result = CronFireContract.execute(
      makeInput("Please run the tests and check coverage"),
      deps,
    );

    expect(result.ok).toBe(true);
    const written = readWrittenFile(deps);
    expect(written.crons[0].fireCount).toBe(1);
  });
});

// ─── Only updates matched cron ──────────────────────────────────────────────

describe("CronFireContract.execute() — selective update", () => {
  it("only updates the matched cron, leaves others unchanged", () => {
    const deps = makeDeps({ now: () => 9999999 });
    seedCronFile(deps, [
      makeCron({
        id: "cron-1",
        prompt: "deploy to production",
        fireCount: 5,
        lastFired: 100,
      }),
      makeCron({
        id: "cron-2",
        prompt: "run the tests",
        fireCount: 0,
        lastFired: null,
      }),
      makeCron({
        id: "cron-3",
        prompt: "check logs",
        fireCount: 3,
        lastFired: 200,
      }),
    ]);

    CronFireContract.execute(makeInput("run the tests"), deps);

    const written = readWrittenFile(deps);

    // cron-1 unchanged
    expect(written.crons[0].id).toBe("cron-1");
    expect(written.crons[0].fireCount).toBe(5);
    expect(written.crons[0].lastFired).toBe(100);

    // cron-2 updated
    expect(written.crons[1].id).toBe("cron-2");
    expect(written.crons[1].fireCount).toBe(1);
    expect(written.crons[1].lastFired).toBe(9999999);

    // cron-3 unchanged
    expect(written.crons[2].id).toBe("cron-3");
    expect(written.crons[2].fireCount).toBe(3);
    expect(written.crons[2].lastFired).toBe(200);
  });

  it("matches only the first cron when multiple could match", () => {
    const deps = makeDeps({ now: () => 5000000 });
    seedCronFile(deps, [
      makeCron({ id: "cron-1", prompt: "run", fireCount: 0, lastFired: null }),
      makeCron({
        id: "cron-2",
        prompt: "run the tests",
        fireCount: 0,
        lastFired: null,
      }),
    ]);

    CronFireContract.execute(makeInput("run the tests now"), deps);

    const written = readWrittenFile(deps);

    // First match (cron-1 "run" is substring of prompt) should be updated
    expect(written.crons[0].fireCount).toBe(1);
    expect(written.crons[0].lastFired).toBe(5000000);

    // Second (cron-2) should NOT be updated even though it also matches
    expect(written.crons[1].fireCount).toBe(0);
    expect(written.crons[1].lastFired).toBeNull();
  });
});

// ─── Legacy fallback ────────────────────────────────────────────────────────

describe("CronFireContract.execute() — legacy user_prompt fallback", () => {
  it("uses user_prompt when prompt is undefined", () => {
    const deps = makeDeps();
    seedCronFile(deps, [makeCron({ prompt: "run the tests", fireCount: 0 })]);

    const input: UserPromptSubmitInput = {
      session_id: "test-session-001",
      user_prompt: "run the tests",
    };
    const result = CronFireContract.execute(input, deps);

    expect(result.ok).toBe(true);
    const written = readWrittenFile(deps);
    expect(written.crons[0].fireCount).toBe(1);
  });
});

// ─── Contract metadata ──────────────────────────────────────────────────────

describe("CronFireContract metadata", () => {
  it("has name CronFire", () => {
    expect(CronFireContract.name).toBe("CronFire");
  });

  it("has event UserPromptSubmit", () => {
    expect(CronFireContract.event).toBe("UserPromptSubmit");
  });
});
