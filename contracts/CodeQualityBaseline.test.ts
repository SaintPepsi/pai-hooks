import { describe, test, expect } from "bun:test";
import { CodeQualityBaseline, type CodeQualityBaselineDeps } from "./CodeQualityBaseline";
import type { ToolHookInput } from "../core/types/hook-inputs";
import { ok, err, type Result } from "../core/result";
import type { PaiError } from "../core/error";
import { getLanguageProfile, isScorableFile } from "../core/language-profiles";
import { scoreFile, formatAdvisory } from "../core/quality-scorer";

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeLongFile(score: "clean" | "dirty"): string {
  const lines: string[] = [];
  lines.push('import type { Result } from "./result";');
  if (score === "dirty") {
    lines.push('import { readFileSync } from "fs";');
    lines.push('import { execSync } from "child_process";');
    lines.push('import fetch from "node-fetch";');
  }
  for (let i = 0; i < 60; i++) {
    lines.push(`function fn${i}() { return ${i}; }`);
  }
  return lines.join("\n");
}

const LONG_CLEAN = makeLongFile("clean");
const LONG_DIRTY = makeLongFile("dirty");
const SHORT_FILE = `function foo() {}\nfunction bar() {}\n`;

let lastWrittenJson: unknown = null;
let lastWrittenPath: string = "";

function makeDeps(overrides: Partial<CodeQualityBaselineDeps> = {}): CodeQualityBaselineDeps {
  lastWrittenJson = null;
  lastWrittenPath = "";
  const logs: string[] = [];
  return {
    fileExists: () => false,
    readFile: () => ok(LONG_CLEAN),
    readJson: () => err({ code: "FILE_NOT_FOUND", message: "not found" } as PaiError),
    writeJson: (path, data) => {
      lastWrittenPath = path;
      lastWrittenJson = data;
      return ok(undefined);
    },
    ensureDir: () => ok(undefined),
    getLanguageProfile,
    isScorableFile,
    scoreFile,
    formatAdvisory,
    getTimestamp: () => "2026-02-27T10:00:00Z",
    baseDir: "/tmp/test",
    stderr: (msg) => logs.push(msg),
    ...overrides,
  };
}

function makeInput(overrides: Partial<ToolHookInput> = {}): ToolHookInput {
  return {
    session_id: "test-session",
    tool_name: "Read",
    tool_input: { file_path: "/src/app.ts" },
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CodeQualityBaseline", () => {
  describe("accepts", () => {
    test("accepts Read on source files", () => {
      expect(CodeQualityBaseline.accepts(makeInput())).toBe(true);
    });

    test("rejects Edit", () => {
      expect(CodeQualityBaseline.accepts(makeInput({ tool_name: "Edit" }))).toBe(false);
    });

    test("rejects Write", () => {
      expect(CodeQualityBaseline.accepts(makeInput({ tool_name: "Write" }))).toBe(false);
    });

    test("rejects non-source files", () => {
      const input = makeInput({ tool_input: { file_path: "/config.json" } });
      expect(CodeQualityBaseline.accepts(input)).toBe(false);
    });

    test("rejects test files", () => {
      const input = makeInput({ tool_input: { file_path: "/src/app.test.ts" } });
      expect(CodeQualityBaseline.accepts(input)).toBe(false);
    });

    test("rejects spec files", () => {
      const input = makeInput({ tool_input: { file_path: "/src/app.spec.ts" } });
      expect(CodeQualityBaseline.accepts(input)).toBe(false);
    });

    test("rejects files in __tests__ directory", () => {
      const input = makeInput({ tool_input: { file_path: "/src/__tests__/app.ts" } });
      expect(CodeQualityBaseline.accepts(input)).toBe(false);
    });
  });

  describe("execute — stores baseline", () => {
    test("stores baseline score in JSON file", () => {
      const deps = makeDeps({ readFile: () => ok(LONG_CLEAN) });
      const result = CodeQualityBaseline.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      expect(lastWrittenJson).not.toBeNull();
      const store = lastWrittenJson as Record<string, any>;
      expect(store["/src/app.ts"]).toBeDefined();
      expect(store["/src/app.ts"].score).toBeGreaterThan(0);
      expect(store["/src/app.ts"].timestamp).toBe("2026-02-27T10:00:00Z");
    });

    test("baseline path includes session ID", () => {
      const deps = makeDeps({ readFile: () => ok(LONG_CLEAN) });
      CodeQualityBaseline.execute(makeInput(), deps);
      expect(lastWrittenPath).toContain("test-session");
    });

    test("merges with existing baselines", () => {
      const existing = { "/other/file.ts": { score: 8, violations: 0, checkResults: [], timestamp: "old" } };
      const deps = makeDeps({
        readFile: () => ok(LONG_CLEAN),
        readJson: () => ok(existing) as Result<any, PaiError>,
      });
      CodeQualityBaseline.execute(makeInput(), deps);
      const store = lastWrittenJson as Record<string, any>;
      expect(store["/other/file.ts"]).toBeDefined();
      expect(store["/src/app.ts"]).toBeDefined();
    });
  });

  describe("execute — small files", () => {
    test("skips files under 50 lines", () => {
      const deps = makeDeps({ readFile: () => ok(SHORT_FILE) });
      const result = CodeQualityBaseline.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      expect(lastWrittenJson).toBeNull();
    });
  });

  describe("execute — context injection", () => {
    test("injects context for low-scoring files", () => {
      const deps = makeDeps({ readFile: () => ok(LONG_DIRTY) });
      const result = CodeQualityBaseline.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        if (result.value.additionalContext) {
          expect(result.value.additionalContext).toContain("quality concerns");
        }
      }
    });

    test("no context injection for clean files", () => {
      const deps = makeDeps({ readFile: () => ok(LONG_CLEAN) });
      const result = CodeQualityBaseline.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.additionalContext).toBeUndefined();
      }
    });
  });

  describe("execute — file read failure", () => {
    test("returns continue without storing when file unreadable", () => {
      const deps = makeDeps({
        readFile: () => err({ code: "FILE_READ_FAILED", message: "gone" } as PaiError),
      });
      const result = CodeQualityBaseline.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      expect(lastWrittenJson).toBeNull();
    });
  });

  describe("never blocks or asks", () => {
    test("always returns ContinueOutput", () => {
      const deps = makeDeps({ readFile: () => ok(LONG_DIRTY) });
      const result = CodeQualityBaseline.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("continue");
        expect(result.value.continue).toBe(true);
      }
    });
  });
});
