import { describe, test, expect } from "bun:test";
import { SessionQualityReport, type SessionQualityReportDeps } from "./SessionQualityReport";
import type { SessionEndInput } from "../core/types/hook-inputs";
import { ok, err, type Result } from "../core/result";
import type { PaiError } from "../core/error";

// ─── Test Helpers ────────────────────────────────────────────────────────────

let lastWrittenContent: string = "";
let lastWrittenPath: string = "";

const MOCK_BASELINES = {
  "/src/app.ts": { score: 8.5, violations: 1, timestamp: "2026-02-27T10:00:00Z" },
  "/src/bloated.ts": { score: 4.2, violations: 5, timestamp: "2026-02-27T10:05:00Z" },
  "/src/clean.ts": { score: 10, violations: 0, timestamp: "2026-02-27T10:10:00Z" },
};

const MOCK_TIME = {
  year: "2026",
  month: "02",
  day: "27",
  hours: "10",
  minutes: "30",
  seconds: "00",
};

function makeDeps(overrides: Partial<SessionQualityReportDeps> = {}): SessionQualityReportDeps {
  lastWrittenContent = "";
  lastWrittenPath = "";
  return {
    fileExists: () => true,
    readFile: () => ok(""),
    readJson: () => ok(MOCK_BASELINES) as Result<any, PaiError>,
    writeFile: (path, content) => {
      lastWrittenPath = path;
      lastWrittenContent = content;
      return ok(undefined);
    },
    ensureDir: () => ok(undefined),
    getLocalComponents: () => MOCK_TIME,
    baseDir: "/tmp/test",
    stderr: () => {},
    ...overrides,
  };
}

function makeInput(overrides: Partial<SessionEndInput> = {}): SessionEndInput {
  return {
    session_id: "test-session",
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("SessionQualityReport", () => {
  describe("accepts", () => {
    test("accepts when session_id present", () => {
      expect(SessionQualityReport.accepts(makeInput())).toBe(true);
    });

    test("rejects when session_id missing", () => {
      expect(SessionQualityReport.accepts(makeInput({ session_id: "" }))).toBe(false);
    });
  });

  describe("execute — generates report", () => {
    test("writes report to QUALITY directory", () => {
      const deps = makeDeps();
      const result = SessionQualityReport.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      expect(lastWrittenPath).toContain("LEARNING/QUALITY/2026-02");
      expect(lastWrittenPath).toContain(".md");
    });

    test("report contains session ID", () => {
      const deps = makeDeps();
      SessionQualityReport.execute(makeInput(), deps);
      expect(lastWrittenContent).toContain("test-session");
    });

    test("report contains date", () => {
      const deps = makeDeps();
      SessionQualityReport.execute(makeInput(), deps);
      expect(lastWrittenContent).toContain("2026-02-27");
    });

    test("report contains file count", () => {
      const deps = makeDeps();
      SessionQualityReport.execute(makeInput(), deps);
      expect(lastWrittenContent).toContain("3");
    });

    test("report lists files with scores", () => {
      const deps = makeDeps();
      SessionQualityReport.execute(makeInput(), deps);
      expect(lastWrittenContent).toContain("app.ts");
      expect(lastWrittenContent).toContain("bloated.ts");
      expect(lastWrittenContent).toContain("clean.ts");
      expect(lastWrittenContent).toContain("8.5/10");
      expect(lastWrittenContent).toContain("4.2/10");
      expect(lastWrittenContent).toContain("10/10");
    });

    test("report highlights low-scoring files", () => {
      const deps = makeDeps();
      SessionQualityReport.execute(makeInput(), deps);
      expect(lastWrittenContent).toContain("Needing Attention");
      expect(lastWrittenContent).toContain("bloated.ts");
    });

    test("report highlights clean files", () => {
      const deps = makeDeps();
      SessionQualityReport.execute(makeInput(), deps);
      expect(lastWrittenContent).toContain("Clean Files");
      expect(lastWrittenContent).toContain("clean.ts");
    });

    test("returns SilentOutput", () => {
      const deps = makeDeps();
      const result = SessionQualityReport.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("silent");
      }
    });
  });

  describe("execute — no baselines", () => {
    test("skips when baseline file does not exist", () => {
      const deps = makeDeps({ fileExists: () => false });
      const result = SessionQualityReport.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      expect(lastWrittenContent).toBe("");
    });

    test("skips when baselines are empty", () => {
      const deps = makeDeps({
        readJson: () => ok({}) as Result<any, PaiError>,
      });
      const result = SessionQualityReport.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      expect(lastWrittenContent).toBe("");
    });

    test("skips when baselines unreadable", () => {
      const deps = makeDeps({
        readJson: () => err({ code: "FILE_READ_FAILED", message: "corrupt" } as PaiError),
      });
      const result = SessionQualityReport.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      expect(lastWrittenContent).toBe("");
    });
  });

  describe("execute — average score", () => {
    test("calculates average score correctly", () => {
      const deps = makeDeps();
      SessionQualityReport.execute(makeInput(), deps);
      // (8.5 + 4.2 + 10) / 3 = 7.6
      expect(lastWrittenContent).toContain("7.6/10");
    });
  });
});
