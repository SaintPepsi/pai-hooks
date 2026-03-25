/**
 * CronSessionEnd Contract Tests
 *
 * Validates that the session's cron file is removed on SessionEnd
 * and the pruned event is logged with reason "session_ended".
 */

import { describe, it, expect } from "bun:test";
import { CronSessionEnd, type CronSessionEndDeps } from "./CronSessionEnd.contract";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import type { CronSessionFile } from "@hooks/hooks/CronStatusLine/shared";
import { ok, err } from "@hooks/core/result";
import { PaiError, ErrorCode } from "@hooks/core/error";

// ─── Test Helpers ────────────────────────────────────────────────────────────

const MOCK_SESSION_FILE: CronSessionFile = {
  sessionId: "test-session-123",
  crons: [
    { id: "c1", name: "poll", schedule: "*/5 * * * *", recurring: true, prompt: "check status", createdAt: 0, fireCount: 3, lastFired: 1000 },
    { id: "c2", name: "sync", schedule: "*/10 * * * *", recurring: true, prompt: "sync data", createdAt: 0, fireCount: 1, lastFired: 2000 },
  ],
};

function makeDeps(overrides: Partial<CronSessionEndDeps> = {}): CronSessionEndDeps {
  return {
    getEnv: (key: string) => {
      if (key === "PAI_DIR") return "/tmp/test-pai";
      if (key === "HOME") return "/tmp";
      return undefined;
    },
    readFile: () => ok(JSON.stringify(MOCK_SESSION_FILE)),
    writeFile: () => ok(undefined),
    fileExists: () => true,
    ensureDir: () => ok(undefined),
    readDir: () => ok([]),
    removeFile: () => ok(undefined),
    appendFile: () => ok(undefined),
    stderr: () => {},
    ...overrides,
  };
}

function makeInput(sessionId = "test-session-123"): SessionEndInput {
  return { session_id: sessionId };
}

// ─── Contract Metadata ──────────────────────────────────────────────────────

describe("CronSessionEnd contract", () => {
  it("has correct name and event", () => {
    expect(CronSessionEnd.name).toBe("CronSessionEnd");
    expect(CronSessionEnd.event).toBe("SessionEnd");
  });

  it("accepts() always returns true", () => {
    expect(CronSessionEnd.accepts(makeInput())).toBe(true);
    expect(CronSessionEnd.accepts(makeInput("other"))).toBe(true);
  });
});

// ─── Execution Logic ────────────────────────────────────────────────────────

describe("CronSessionEnd execute", () => {
  it("removes the session's cron file", () => {
    const removed: string[] = [];
    const deps = makeDeps({
      removeFile: (path: string) => { removed.push(path); return ok(undefined); },
    });

    const result = CronSessionEnd.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(removed.length).toBe(1);
    expect(removed[0]).toContain("test-session-123.json");
  });

  it("returns silent when no cron file exists for session", () => {
    const removed: string[] = [];
    const deps = makeDeps({
      fileExists: () => false,
      removeFile: (path: string) => { removed.push(path); return ok(undefined); },
    });

    const result = CronSessionEnd.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("silent");
    }
    expect(removed.length).toBe(0);
  });

  it("logs pruned event with reason session_ended and correct cronCount", () => {
    const logged: string[] = [];
    const deps = makeDeps({
      appendFile: (_path: string, content: string) => { logged.push(content); return ok(undefined); },
    });

    const result = CronSessionEnd.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(logged.length).toBe(1);

    const event = JSON.parse(logged[0]);
    expect(event.type).toBe("pruned");
    expect(event.sessionId).toBe("test-session-123");
    expect(event.cronCount).toBe(2);
    expect(event.reason).toBe("session_ended");
  });

  it("returns silent on success", () => {
    const deps = makeDeps();
    const result = CronSessionEnd.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("silent");
    }
  });

  it("returns silent when removeFile fails (does not crash hook chain)", () => {
    const stderrOutput: string[] = [];
    const deps = makeDeps({
      removeFile: () => err(new PaiError(ErrorCode.FileWriteFailed, "permission denied")),
      stderr: (msg: string) => { stderrOutput.push(msg); },
    });

    const result = CronSessionEnd.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("silent");
    }
    expect(stderrOutput.length).toBe(1);
    expect(stderrOutput[0]).toContain("permission denied");
  });

  it("logs cronCount 0 when cron file is unreadable", () => {
    const logged: string[] = [];
    const deps = makeDeps({
      readFile: () => err(new PaiError(ErrorCode.FileReadFailed, "corrupt")),
      appendFile: (_path: string, content: string) => { logged.push(content); return ok(undefined); },
    });

    const result = CronSessionEnd.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(logged.length).toBe(1);

    const event = JSON.parse(logged[0]);
    expect(event.cronCount).toBe(0);
    expect(event.reason).toBe("session_ended");
  });
});
