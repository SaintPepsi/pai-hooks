import { describe, expect, test } from "bun:test";
import type { ResultError } from "@hooks/core/error";
import { err, ok, type Result } from "@hooks/core/result";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import { SessionSummary, type SessionSummaryDeps } from "./SessionSummary.contract";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

let lastWrittenPath: string = "";
let lastWrittenContent: string = "";
let deletedPaths: string[] = [];

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

  return {
    ...SessionSummary.defaultDeps,
    fileExists: (path: string) => {
      if (path.includes("current-work-test-session-123.json")) return true;
      if (path.includes("current-work.json")) return false;
      return false;
    },
    readFile: (path: string) => {
      if (path.includes("META.yaml")) return ok(MOCK_META_YAML);
      return err({
        code: "FILE_NOT_FOUND",
        message: `Not found: ${path}`,
      } as ResultError);
    },
    readJson: <T = unknown>(_path: string) => ok(MOCK_WORK_STATE) as Result<T, ResultError>,
    writeFile: (path: string, content: string) => {
      lastWrittenPath = path;
      lastWrittenContent = content;
      return ok(undefined);
    },
    unlinkSync: (path: string) => {
      deletedPaths.push(path);
    },
    getTimestamp: () => MOCK_TIMESTAMP,
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
      expect(
        SessionSummary.accepts({
          session_id: undefined as unknown as string,
        } as SessionEndInput),
      ).toBe(true);
    });
  });

  describe("execute — returns silent output", () => {
    test("always returns ok with empty output", () => {
      const deps = makeDeps();
      const result = SessionSummary.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({});
      }
    });
  });

  describe("execute — scoped state file (current-work-{session_id}.json)", () => {
    test("reads the scoped state file path", () => {
      let readJsonPath = "";
      const deps = makeDeps({
        readJson: <T = unknown>(path: string) => {
          readJsonPath = path;
          return ok(MOCK_WORK_STATE) as Result<T, ResultError>;
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
      expect(lastWrittenPath).toBe("/tmp/test/MEMORY/WORK/2026-02-27-fix-auth/META.yaml");
    });

    test("deletes the scoped state file", () => {
      const deps = makeDeps();
      SessionSummary.execute(makeInput(), deps);
      expect(deletedPaths).toContain("/tmp/test/MEMORY/STATE/current-work-test-session-123.json");
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
  });

  describe("execute — mismatched session ID", () => {
    test("skips state update when session_id does not match state file", () => {
      const deps = makeDeps({
        readJson: <T = unknown>(_path: string) =>
          ok({
            session_id: "different-session-999",
            session_dir: "2026-02-27-other",
          }) as Result<T, ResultError>,
      });
      SessionSummary.execute(makeInput({ session_id: "test-session-123" }), deps);
      expect(lastWrittenPath).toBe("");
      expect(deletedPaths).toHaveLength(0);
    });

    test("still returns ok result when session ID mismatches", () => {
      const deps = makeDeps({
        readJson: <T = unknown>(_path: string) =>
          ok({
            session_id: "different-session-999",
            session_dir: "2026-02-27-other",
          }) as Result<T, ResultError>,
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
        readFile: () => err({ code: "FILE_NOT_FOUND", message: "no meta" } as ResultError),
      });
      SessionSummary.execute(makeInput(), deps);
      expect(lastWrittenPath).toBe("");
    });

    test("still deletes state file even if META.yaml read fails", () => {
      const deps = makeDeps({
        readFile: () => err({ code: "FILE_NOT_FOUND", message: "no meta" } as ResultError),
      });
      SessionSummary.execute(makeInput(), deps);
      expect(deletedPaths).toContain("/tmp/test/MEMORY/STATE/current-work-test-session-123.json");
    });
  });
});
