import { describe, test, expect } from "bun:test";
import { CodeQualityGuard, type CodeQualityGuardDeps } from "./CodeQualityGuard";
import type { ToolHookInput } from "../core/types/hook-inputs";
import { ok, err, type Result } from "../core/result";
import type { PaiError } from "../core/error";
import { getLanguageProfile, isScorableFile } from "../core/language-profiles";
import { scoreFile, formatAdvisory, formatDelta } from "../core/quality-scorer";

// ─── Test Helpers ────────────────────────────────────────────────────────────

const CLEAN_TS = `
import type { Result } from "./result";
function run(): Result<void, Error> { return { ok: true, value: undefined }; }
`;

const BLOATED_TS = `
import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import fetch from "node-fetch";

function loadConfig() {}
function saveConfig() {}
function fetchApi() {}
function runCommand() {}
function parseInput() {}
function formatOutput() {}
function handleError() {}
function validateInput() {}
function processData() {}
function transformData() {}
function sendNotification() {}
function logActivity() {}
function checkPermissions() {}
function buildReport() {}
function cleanupTemp() {}
function archiveOld() {}
`;

function makeDeps(overrides: Partial<CodeQualityGuardDeps> = {}): CodeQualityGuardDeps {
  const logs: string[] = [];
  return {
    fileExists: () => false,
    readFile: (path) => ok(CLEAN_TS),
    readJson: () => err({ code: "FILE_NOT_FOUND", message: "not found" } as PaiError),
    getLanguageProfile,
    isScorableFile,
    scoreFile,
    formatAdvisory,
    formatDelta,
    signal: {
      appendFile: () => ok(undefined as void),
      ensureDir: () => ok(undefined as void),
      baseDir: "/tmp/test",
    },
    stderr: (msg) => logs.push(msg),
    ...overrides,
  };
}

function makeInput(overrides: Partial<ToolHookInput> = {}): ToolHookInput {
  return {
    session_id: "test-session",
    tool_name: "Edit",
    tool_input: { file_path: "/src/app.ts" },
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CodeQualityGuard", () => {
  describe("accepts", () => {
    test("accepts Edit on source files", () => {
      expect(CodeQualityGuard.accepts(makeInput({ tool_name: "Edit" }))).toBe(true);
    });

    test("accepts Write on source files", () => {
      expect(CodeQualityGuard.accepts(makeInput({ tool_name: "Write" }))).toBe(true);
    });

    test("rejects Read", () => {
      expect(CodeQualityGuard.accepts(makeInput({ tool_name: "Read" }))).toBe(false);
    });

    test("rejects Bash", () => {
      expect(CodeQualityGuard.accepts(makeInput({ tool_name: "Bash" }))).toBe(false);
    });

    test("rejects non-source files", () => {
      const input = makeInput({ tool_input: { file_path: "/src/config.json" } });
      expect(CodeQualityGuard.accepts(input)).toBe(false);
    });

    test("rejects markdown files", () => {
      const input = makeInput({ tool_input: { file_path: "/docs/README.md" } });
      expect(CodeQualityGuard.accepts(input)).toBe(false);
    });

    test("rejects when no file_path", () => {
      const input = makeInput({ tool_input: { command: "ls" } });
      expect(CodeQualityGuard.accepts(input)).toBe(false);
    });
  });

  describe("execute — clean file", () => {
    test("returns continue without context for clean files", () => {
      const deps = makeDeps({ readFile: () => ok(CLEAN_TS) });
      const result = CodeQualityGuard.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("continue");
        expect(result.value.continue).toBe(true);
      }
    });
  });

  describe("execute — bloated file", () => {
    test("returns continue with advisory for violation-heavy files", () => {
      const deps = makeDeps({ readFile: () => ok(BLOATED_TS) });
      const result = CodeQualityGuard.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("continue");
        expect(result.value.continue).toBe(true);
        expect(result.value.additionalContext).toBeDefined();
        expect(result.value.additionalContext).toContain("SOLID quality:");
      }
    });
  });

  describe("execute — file read failure", () => {
    test("returns continue without context when file unreadable", () => {
      const deps = makeDeps({
        readFile: () => err({ code: "FILE_READ_FAILED", message: "gone" } as PaiError),
      });
      const result = CodeQualityGuard.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.additionalContext).toBeUndefined();
      }
    });
  });

  describe("execute — quality delta (Phase 7d)", () => {
    test("includes delta when baseline exists and score changed", () => {
      const baseline = {
        "/src/app.ts": {
          score: 4.0,
          violations: 3,
          checkResults: [],
        },
      };
      const deps = makeDeps({
        readFile: () => ok(CLEAN_TS),
        readJson: () => ok(baseline) as Result<any, PaiError>,
      });
      const result = CodeQualityGuard.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok && result.value.additionalContext) {
        expect(result.value.additionalContext).toContain("improved");
      }
    });

    test("no delta when no baseline exists", () => {
      const deps = makeDeps({
        readFile: () => ok(BLOATED_TS),
        readJson: () => err({ code: "FILE_NOT_FOUND", message: "not found" } as PaiError),
      });
      const result = CodeQualityGuard.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok && result.value.additionalContext) {
        expect(result.value.additionalContext).not.toContain("improved");
        expect(result.value.additionalContext).not.toContain("degraded");
      }
    });
  });

  describe("never blocks or asks", () => {
    test("always returns ContinueOutput type", () => {
      const deps = makeDeps({ readFile: () => ok(BLOATED_TS) });
      const result = CodeQualityGuard.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("continue");
        expect((result.value as any).decision).toBeUndefined();
      }
    });
  });
});
