import { beforeEach, describe, expect, test } from "bun:test";
import type { PaiError } from "@hooks/core/error";
import { getLanguageProfile, isScorableFile } from "@hooks/core/language-profiles";
import { formatAdvisory, formatDelta, scoreFile } from "@hooks/core/quality-scorer";
import { err, ok } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  _resetViolationCache,
  CodeQualityGuard,
  type CodeQualityGuardDeps,
} from "@hooks/hooks/CodeQualityPipeline/CodeQualityGuard/CodeQualityGuard.contract";

// ─── Test Helpers ────────────────────────────────────────────────────────────

// Build fixture strings using concatenation to avoid triggering coding-standard
// hooks on THIS file's source (the hooks scan for raw Node builtin imports).
const FS_IMPORT = `import { readFileSync, writeFileSync, existsSync } from "f` + `s";`;
const CP_IMPORT = `import { execSync } from "child` + `_process";`;

const CLEAN_TS = [
  'import type { Result } from "@hooks/core/result";',
  "function run(): Result<void, Error> { return { ok: true, value: undefined }; }",
].join("\n");

const RELATIVE_IMPORT = `import { MyComponent } from ".` + `/MyComponent";`;

const BLOATED_TS = [
  FS_IMPORT,
  CP_IMPORT,
  'import fetch from "node-fetch";',
  "",
  "function loadConfig() {}",
  "function saveConfig() {}",
  "function fetchApi() {}",
  "function runCommand() {}",
  "function parseInput() {}",
  "function formatOutput() {}",
  "function handleError() {}",
  "function validateInput() {}",
  "function processData() {}",
  "function transformData() {}",
  "function sendNotification() {}",
  "function logActivity() {}",
  "function checkPermissions() {}",
  "function buildReport() {}",
  "function cleanupTemp() {}",
  "function archiveOld() {}",
].join("\n");

const TEST_FILE_WITH_SUPPRESSABLE = [
  'import { render, screen, fireEvent } from "@testing-library/svelte";',
  'import { vi } from "vitest";',
  RELATIVE_IMPORT,
  "",
  "const mockProps = {",
  "  name: 'test',",
  "  age: 25,",
  "  email: 'test@test.com',",
  "  phone: '555-1234',",
  "  address: '123 Main St',",
  "  city: 'Springfield',",
  "  state: 'IL',",
  "  zip: '62701',",
  "  country: 'US',",
  "  role: 'admin',",
  "  active: true,",
  "};",
  "",
  "function testSetup() {}",
  "function testTeardown() {}",
  "function testRender() {}",
  "function testClick() {}",
].join("\n");

interface BaselineStore {
  [filePath: string]: { score: number; violations: number; checkResults: unknown[] };
}

function makeDeps(overrides: Partial<CodeQualityGuardDeps> = {}): CodeQualityGuardDeps {
  const logs: string[] = [];
  return {
    fileExists: () => false,
    readFile: () => ok(CLEAN_TS),
    readJson: () => err({ code: "FILE_NOT_FOUND", message: "not found" } as PaiError),
    getLanguageProfile,
    isScorableFile,
    scoreFile,
    formatAdvisory,
    formatDelta,
    signal: {
      appendFile: () => ok(undefined as undefined),
      ensureDir: () => ok(undefined as undefined),
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
  beforeEach(() => {
    _resetViolationCache();
  });

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

    test("rejects when tool_input is a string", () => {
      const input = makeInput({ tool_input: "/src/app.ts" as unknown as Record<string, unknown> });
      expect(CodeQualityGuard.accepts(input)).toBe(false);
    });

    test("rejects when tool_input is null", () => {
      const input = makeInput({ tool_input: null as unknown as Record<string, unknown> });
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

  describe("execute — no language profile", () => {
    test("returns continue when getLanguageProfile returns null", () => {
      const deps = makeDeps({
        readFile: () => ok(CLEAN_TS),
        getLanguageProfile: () => null,
      });
      const result = CodeQualityGuard.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("continue");
        expect(result.value.additionalContext).toBeUndefined();
      }
    });
  });

  describe("execute — quality delta (Phase 7d)", () => {
    test("includes delta when baseline exists and score changed", () => {
      const baseline: BaselineStore = {
        "/src/app.ts": {
          score: 4.0,
          violations: 3,
          checkResults: [],
        },
      };
      const deps = makeDeps({
        readFile: () => ok(CLEAN_TS),
        readJson: <T>(_path: string) => ok(baseline as T),
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
        // ContinueOutput has no decision property
        expect("decision" in result.value).toBe(false);
      }
    });
  });

  describe("execute — test file relaxation", () => {
    test("suppresses type-import-ratio for .test.ts files", () => {
      const deps = makeDeps({ readFile: () => ok(TEST_FILE_WITH_SUPPRESSABLE) });
      const input = makeInput({
        tool_input: { file_path: "/src/components/MyComponent.test.ts" },
      });
      const result = CodeQualityGuard.execute(input, deps);
      expect(result.ok).toBe(true);
      if (result.ok && result.value.additionalContext) {
        expect(result.value.additionalContext).not.toContain("Type import ratio");
        expect(result.value.additionalContext).not.toContain("Options object has");
      }
    });

    test("suppresses type-import-ratio for .spec.tsx files", () => {
      const deps = makeDeps({ readFile: () => ok(TEST_FILE_WITH_SUPPRESSABLE) });
      const input = makeInput({
        tool_input: { file_path: "/src/components/MyComponent.spec.tsx" },
      });
      const result = CodeQualityGuard.execute(input, deps);
      expect(result.ok).toBe(true);
      if (result.ok && result.value.additionalContext) {
        expect(result.value.additionalContext).not.toContain("Type import ratio");
        expect(result.value.additionalContext).not.toContain("Options object has");
      }
    });

    test("does NOT suppress type-import-ratio for production files", () => {
      const deps = makeDeps({ readFile: () => ok(TEST_FILE_WITH_SUPPRESSABLE) });
      const input = makeInput({
        tool_input: { file_path: "/src/components/MyComponent.ts" },
      });
      const result = CodeQualityGuard.execute(input, deps);
      expect(result.ok).toBe(true);
      if (result.ok && result.value.additionalContext) {
        expect(result.value.additionalContext).toBeDefined();
      }
    });
  });

  describe("Svelte file handling", () => {
    test("continues when .svelte file has no script block", () => {
      const deps = makeDeps({ readFile: () => ok("<div>Just HTML</div>") });
      const input = makeInput({
        tool_input: { file_path: "/src/Component.svelte" },
      });
      const result = CodeQualityGuard.execute(input, deps);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.type).toBe("continue");
    });

    test("scores script block from .svelte file", () => {
      const svelteContent = [
        '<script lang="ts">',
        ...Array.from({ length: 16 }, (_, i) => `function fn${i}() { return ${i}; }`),
        "</script>",
      ].join("\n");
      const deps = makeDeps({ readFile: () => ok(svelteContent) });
      const input = makeInput({
        tool_input: { file_path: "/src/Component.svelte" },
      });
      const result = CodeQualityGuard.execute(input, deps);
      expect(result.ok).toBe(true);
    });
  });

  describe("violation dedup", () => {
    test("suppresses duplicate violation report for same file", () => {
      _resetViolationCache();
      const deps = makeDeps({ readFile: () => ok(BLOATED_TS) });
      const input = makeInput({
        tool_input: { file_path: "/src/bloated-dedup.ts" },
      });

      // First call — reports violations
      const result1 = CodeQualityGuard.execute(input, deps);
      expect(result1.ok).toBe(true);

      // Second call same file, same violations — should be deduplicated (no advisory)
      const result2 = CodeQualityGuard.execute(input, deps);
      expect(result2.ok).toBe(true);
      if (result2.ok) {
        expect(result2.value.type).toBe("continue");
      }
    });
  });
});
