import { describe, test, expect } from "bun:test";
import { SessionSummary, type SessionSummaryDeps } from "@hooks/contracts/SessionSummary";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import { ok, err, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

let lastWrittenPath: string = "";
let lastWrittenContent: string = "";
let deletedPaths: string[] = [];
let setTabStateCalls: Array<{ title: string; state: string; sessionId?: string }> = [];
let cleanupKittySessionCalls: string[] = [];

const MOCK_TIMESTAMP = "2026-02-27T10:00:00Z";

const MOCK_META_YAML = `title: "Fix authentication bug"
status: "ACTIVE"
started_at: "2026-02-27T09:00:00Z"
completed_at: null
session_id: "test-session-123"
`;

const MOCK_WORK_STATE = {
  session_id: "test-session-123",
  session_dir: "2026-02-27-fix-auth",
};

function makeDeps(overrides: Partial<SessionSummaryDeps> = {}): SessionSummaryDeps {
  lastWrittenPath = "";
  lastWrittenContent = "";
  deletedPaths = [];
  setTabStateCalls = [];
  cleanupKittySessionCalls = [];

  return {
    ...SessionSummary.defaultDeps,
    fileExists: (path: string) => {
      if (path.includes("current-work-test-session-123.json")) return true;
      if (path.includes("current-work.json")) return false;
      return false;
    },
    readFile: (path: string) => {
      if (path.includes("META.yaml")) return ok(MOCK_META_YAML);
      return err({ code: "FILE_NOT_FOUND", message: `Not found: ${path}` } as PaiError);
    },
    readJson: <T = unknown>(_path: string) => ok(MOCK_WORK_STATE) as Result<T, PaiError>,
    writeFile: (path: string, content: string) => {
      lastWrittenPath = path;
      lastWrittenContent = content;
      return ok(undefined);
    },
    unlinkSync: (path: string) => {
      deletedPaths.push(path);
    },
    getTimestamp: () => MOCK_TIMESTAMP,
    setTabState: (opts: { title: string; state: string; sessionId?: string }) => {
      setTabStateCalls.push(opts);
    },
    cleanupKittySession: (sessionId: string) => {
      cleanupKittySessionCalls.push(sessionId);
    },
    baseDir: "/tmp/test",
    stderr: () => {},
    ...overrides,
  };
}

function makeInput(overrides: Partial<SessionEndInput> = {}): SessionEndInput {
  return {
    session_id: "test-session-123",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SessionSummary", () => {
  describe("accepts", () => {
    test("always accepts any input", () => {
      expect(SessionSummary.accepts(makeInput())).toBe(true);
    });

    test("accepts even without session_id", () => {
      expect(SessionSummary.accepts(makeInput({ session_id: "" }))).toBe(true);
    });

    test("accepts with undefined session_id", () => {
      expect(SessionSummary.accepts({ session_id: undefined as unknown as string } as SessionEndInput)).toBe(true);
    });
  });

  describe("execute — returns SilentOutput", () => {
    test("always returns ok with silent type", () => {
      const deps = makeDeps();
      const result = SessionSummary.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("silent");
      }
    });
  });

  describe("execute — scoped state file (current-work-{session_id}.json)", () => {
    test("reads the scoped state file path", () => {
      let readJsonPath = "";
      const deps = makeDeps({
        readJson: <T = unknown>(path: string) => {
          readJsonPath = path;
          return ok(MOCK_WORK_STATE) as Result<T, PaiError>;
        },
      });
      SessionSummary.execute(makeInput(), deps);
      expect(readJsonPath).toContain("current-work-test-session-123.json");
    });

    test("updates META.yaml status from ACTIVE to COMPLETED", () => {
      const deps = makeDeps();
      SessionSummary.execute(makeInput(), deps);
      expect(lastWrittenContent).toContain('status: "COMPLETED"');
      expect(lastWrittenContent).not.toContain('status: "ACTIVE"');
    });

    test("sets completed_at timestamp in META.yaml", () => {
      const deps = makeDeps();
      SessionSummary.execute(makeInput(), deps);
      expect(lastWrittenContent).toContain(`completed_at: "${MOCK_TIMESTAMP}"`);
      expect(lastWrittenContent).not.toContain("completed_at: null");
    });

    test("writes to correct META.yaml path inside WORK directory", () => {
      const deps = makeDeps();
      SessionSummary.execute(makeInput(), deps);
      expect(lastWrittenPath).toBe(
        "/tmp/test/MEMORY/WORK/2026-02-27-fix-auth/META.yaml",
      );
    });

    test("deletes the scoped state file", () => {
      const deps = makeDeps();
      SessionSummary.execute(makeInput(), deps);
      expect(deletedPaths).toContain(
        "/tmp/test/MEMORY/STATE/current-work-test-session-123.json",
      );
    });
  });

  describe("execute — no legacy fallback (session isolation)", () => {
    test("does not fall back to legacy current-work.json when scoped file absent", () => {
      const deps = makeDeps({
        fileExists: (path: string) => {
          if (path.includes("current-work-test-session-123.json")) return false;
          if (path.includes("current-work.json")) return true;
          return false;
        },
      });
      SessionSummary.execute(makeInput(), deps);
      // Should not delete or write anything — no state found for this session
      expect(deletedPaths).toHaveLength(0);
      expect(lastWrittenPath).toBe("");
    });
  });

  describe("execute — no state file present", () => {
    test("succeeds silently when no state file exists", () => {
      const deps = makeDeps({
        fileExists: () => false,
      });
      const result = SessionSummary.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
    });

    test("does not write or delete anything when no state file", () => {
      const deps = makeDeps({
        fileExists: () => false,
      });
      SessionSummary.execute(makeInput(), deps);
      expect(lastWrittenPath).toBe("");
      expect(deletedPaths).toHaveLength(0);
    });

    test("still resets tab state even with no work file", () => {
      const deps = makeDeps({
        fileExists: () => false,
      });
      SessionSummary.execute(makeInput(), deps);
      expect(setTabStateCalls).toHaveLength(1);
    });
  });

  describe("execute — mismatched session ID", () => {
    test("skips state update when session_id does not match state file", () => {
      const deps = makeDeps({
        readJson: <T = unknown>(_path: string) =>
          ok({ session_id: "different-session-999", session_dir: "2026-02-27-other" }) as Result<T, PaiError>,
      });
      SessionSummary.execute(makeInput({ session_id: "test-session-123" }), deps);
      expect(lastWrittenPath).toBe("");
      expect(deletedPaths).toHaveLength(0);
    });

    test("still returns ok result when session ID mismatches", () => {
      const deps = makeDeps({
        readJson: <T = unknown>(_path: string) =>
          ok({ session_id: "different-session-999", session_dir: "2026-02-27-other" }) as Result<T, PaiError>,
      });
      const result = SessionSummary.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
    });
  });

  describe("execute — tab state reset", () => {
    test("calls setTabState with idle state", () => {
      const deps = makeDeps();
      SessionSummary.execute(makeInput(), deps);
      expect(setTabStateCalls).toHaveLength(1);
      expect(setTabStateCalls[0].state).toBe("idle");
    });

    test("calls setTabState with empty title", () => {
      const deps = makeDeps();
      SessionSummary.execute(makeInput(), deps);
      expect(setTabStateCalls[0].title).toBe("");
    });

    test("passes session_id to setTabState", () => {
      const deps = makeDeps();
      SessionSummary.execute(makeInput(), deps);
      expect(setTabStateCalls[0].sessionId).toBe("test-session-123");
    });

    test("calls cleanupKittySession with session_id", () => {
      const deps = makeDeps();
      SessionSummary.execute(makeInput(), deps);
      expect(cleanupKittySessionCalls).toContain("test-session-123");
    });

    test("skips cleanupKittySession when session_id is empty", () => {
      const deps = makeDeps({
        fileExists: () => false,
      });
      SessionSummary.execute(makeInput({ session_id: "" }), deps);
      expect(cleanupKittySessionCalls).toHaveLength(0);
    });

    test("does not throw if setTabState throws", () => {
      const deps = makeDeps({
        setTabState: () => {
          throw new Error("kitty not running");
        },
      });
      expect(() => SessionSummary.execute(makeInput(), deps)).not.toThrow();
    });

    test("still returns ok if tab reset throws", () => {
      const deps = makeDeps({
        setTabState: () => {
          throw new Error("kitty not running");
        },
      });
      const result = SessionSummary.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
    });
  });

  describe("execute — META.yaml content preservation", () => {
    test("preserves non-status lines in META.yaml", () => {
      const deps = makeDeps();
      SessionSummary.execute(makeInput(), deps);
      expect(lastWrittenContent).toContain('title: "Fix authentication bug"');
      expect(lastWrittenContent).toContain('session_id: "test-session-123"');
    });

    test("does not write META.yaml if readFile fails", () => {
      const deps = makeDeps({
        readFile: () =>
          err({ code: "FILE_NOT_FOUND", message: "no meta" } as PaiError),
      });
      SessionSummary.execute(makeInput(), deps);
      expect(lastWrittenPath).toBe("");
    });

    test("still deletes state file even if META.yaml read fails", () => {
      const deps = makeDeps({
        readFile: () =>
          err({ code: "FILE_NOT_FOUND", message: "no meta" } as PaiError),
      });
      SessionSummary.execute(makeInput(), deps);
      expect(deletedPaths).toContain(
        "/tmp/test/MEMORY/STATE/current-work-test-session-123.json",
      );
    });
  });
});
