import { describe, expect, test } from "bun:test";
import type { ResultError } from "@hooks/core/error";
import { err, ok, type Result } from "@hooks/core/result";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import {
  SessionQualityReport,
  type SessionQualityReportDeps,
} from "./SessionQualityReport.contract";

// -- Test Helpers --

let lastWrittenContent: string = "";
let lastWrittenPath: string = "";

const MOCK_BASELINES = {
  "/src/app.ts": {
    score: 8.5,
    violations: 1,
    timestamp: "2026-02-27T10:00:00Z",
  },
  "/src/bloated.ts": {
    score: 4.2,
    violations: 5,
    timestamp: "2026-02-27T10:05:00Z",
  },
  "/src/clean.ts": {
    score: 10,
    violations: 0,
    timestamp: "2026-02-27T10:10:00Z",
  },
};

const MOCK_TIME = {
  year: 2026,
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
    readJson: <T>() => ok(MOCK_BASELINES) as Result<T, ResultError>,
    writeFile: (path: string, content: string) => {
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

// -- Tests --

describe("SessionQualityReport", () => {
  describe("accepts", () => {
    test("accepts when session_id present", () => {
      expect(SessionQualityReport.accepts(makeInput())).toBe(true);
    });

    test("rejects when session_id missing", () => {
      expect(SessionQualityReport.accepts(makeInput({ session_id: "" }))).toBe(false);
    });
  });

  describe("execute -- generates report", () => {
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

    test("returns silent output", () => {
      const deps = makeDeps();
      const result = SessionQualityReport.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({});
      }
    });
  });

  describe("execute -- no baselines", () => {
    test("skips when baseline file does not exist", () => {
      const deps = makeDeps({ fileExists: () => false });
      const result = SessionQualityReport.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      expect(lastWrittenContent).toBe("");
    });

    test("skips when baselines are empty", () => {
      const deps = makeDeps({
        readJson: <T>() => ok({}) as Result<T, ResultError>,
      });
      const result = SessionQualityReport.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      expect(lastWrittenContent).toBe("");
    });

    test("skips when baselines unreadable", () => {
      const deps = makeDeps({
        readJson: () => err({ code: "FILE_READ_FAILED", message: "corrupt" } as ResultError),
      });
      const result = SessionQualityReport.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      expect(lastWrittenContent).toBe("");
    });
  });

  describe("execute -- average score", () => {
    test("calculates average score correctly", () => {
      const deps = makeDeps();
      SessionQualityReport.execute(makeInput(), deps);
      // (8.5 + 4.2 + 10) / 3 = 7.6
      expect(lastWrittenContent).toContain("7.6/10");
    });
  });

  describe("execute -- edge cases", () => {
    test("report without low-score files omits Needing Attention section", () => {
      const deps = makeDeps({
        readJson: <T>() =>
          ok({
            "/src/clean1.ts": {
              score: 9,
              violations: 0,
              timestamp: "2026-02-27T10:00:00Z",
            },
            "/src/clean2.ts": {
              score: 8,
              violations: 1,
              timestamp: "2026-02-27T10:00:00Z",
            },
          }) as Result<T, ResultError>,
      });
      SessionQualityReport.execute(makeInput(), deps);
      expect(lastWrittenContent).not.toContain("Needing Attention");
    });

    test("report without high-score files omits Clean Files section", () => {
      const deps = makeDeps({
        readJson: <T>() =>
          ok({
            "/src/messy.ts": {
              score: 3,
              violations: 10,
              timestamp: "2026-02-27T10:00:00Z",
            },
          }) as Result<T, ResultError>,
      });
      SessionQualityReport.execute(makeInput(), deps);
      expect(lastWrittenContent).not.toContain("Clean Files");
    });
  });
});

describe("SessionQualityReport defaultDeps", () => {
  test("defaultDeps.fileExists returns a boolean", () => {
    expect(typeof SessionQualityReport.defaultDeps.fileExists("/tmp")).toBe("boolean");
  });

  test("defaultDeps.readFile returns a Result", () => {
    const result = SessionQualityReport.defaultDeps.readFile("/tmp/nonexistent-pai-12345.txt");
    expect(typeof result.ok).toBe("boolean");
  });

  test("defaultDeps.readJson returns a Result", () => {
    const result = SessionQualityReport.defaultDeps.readJson("/tmp/nonexistent-pai-12345.json");
    expect(typeof result.ok).toBe("boolean");
  });

  test("defaultDeps.writeFile returns a Result", () => {
    const result = SessionQualityReport.defaultDeps.writeFile(
      "/tmp/pai-test-sqr-12345.txt",
      "test",
    );
    expect(typeof result.ok).toBe("boolean");
  });

  test("defaultDeps.ensureDir returns a Result", () => {
    const result = SessionQualityReport.defaultDeps.ensureDir("/tmp");
    expect(typeof result.ok).toBe("boolean");
  });

  test("defaultDeps.getLocalComponents returns time components", () => {
    const result = SessionQualityReport.defaultDeps.getLocalComponents();
    expect(typeof result.year).toBe("number");
    expect(typeof result.month).toBe("string");
  });

  test("defaultDeps.stderr writes without throwing", () => {
    expect(() => SessionQualityReport.defaultDeps.stderr("test")).not.toThrow();
  });
});
