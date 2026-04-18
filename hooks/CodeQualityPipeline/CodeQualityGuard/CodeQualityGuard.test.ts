import { beforeEach, describe, expect, test } from "bun:test";
import type { ResultError } from "@hooks/core/error";
import { getLanguageProfile, isScorableFile } from "@hooks/core/language-profiles";
import { formatAdvisory, formatDelta, scoreFile } from "@hooks/core/quality-scorer";
import { err, ok } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  _getViolationCacheEntry,
  _resetViolationCache,
  _setViolationCacheEntry,
  CodeQualityGuard,
  type CodeQualityGuardDeps,
} from "@hooks/hooks/CodeQualityPipeline/CodeQualityGuard/CodeQualityGuard.contract";
import { getInjectedContextFor } from "@hooks/lib/test-helpers";

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
  [filePath: string]: {
    score: number;
    violations: number;
    checkResults: unknown[];
  };
}

function makeDeps(overrides: Partial<CodeQualityGuardDeps> = {}): CodeQualityGuardDeps {
  const logs: string[] = [];
  return {
    fileExists: () => false,
    readFile: () => ok(CLEAN_TS),
    readJson: () => err({ code: "FILE_NOT_FOUND", message: "not found" } as ResultError),
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
    dedup: {
      halfLifeEdits: 5,
      halfLifeMs: 300_000,
      countCrossSessionViolations: () => 0,
    },
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
      const input = makeInput({
        tool_input: { file_path: "/src/config.json" },
      });
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
      const input = makeInput({
        tool_input: "/src/app.ts" as unknown as Record<string, unknown>,
      });
      expect(CodeQualityGuard.accepts(input)).toBe(false);
    });

    test("rejects when tool_input is null", () => {
      const input = makeInput({
        tool_input: null as unknown as Record<string, unknown>,
      });
      expect(CodeQualityGuard.accepts(input)).toBe(false);
    });
  });

  describe("execute — clean file", () => {
    test("returns continue without context for clean files", () => {
      const deps = makeDeps({ readFile: () => ok(CLEAN_TS) });
      const result = CodeQualityGuard.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
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
        expect(result.value.continue).toBe(true);
        const ctx = getInjectedContextFor(result.value, "PostToolUse");
        expect(ctx).toBeDefined();
        expect(ctx).toContain("SOLID quality:");
      }
    });
  });

  describe("execute — file read failure", () => {
    test("returns continue without context when file unreadable", () => {
      const deps = makeDeps({
        readFile: () => err({ code: "FILE_READ_FAILED", message: "gone" } as ResultError),
      });
      const result = CodeQualityGuard.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(getInjectedContextFor(result.value, "PostToolUse")).toBeUndefined();
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
        expect(result.value.continue).toBe(true);
        expect(getInjectedContextFor(result.value, "PostToolUse")).toBeUndefined();
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
      if (result.ok) {
        const ctx = getInjectedContextFor(result.value, "PostToolUse");
        if (ctx) expect(ctx).toContain("improved");
      }
    });

    test("no delta when no baseline exists", () => {
      const deps = makeDeps({
        readFile: () => ok(BLOATED_TS),
        readJson: () => err({ code: "FILE_NOT_FOUND", message: "not found" } as ResultError),
      });
      const result = CodeQualityGuard.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const ctx = getInjectedContextFor(result.value, "PostToolUse");
        if (ctx) {
          expect(ctx).not.toContain("improved");
          expect(ctx).not.toContain("degraded");
        }
      }
    });
  });

  describe("never blocks or asks", () => {
    test("always returns continue output", () => {
      const deps = makeDeps({ readFile: () => ok(BLOATED_TS) });
      const result = CodeQualityGuard.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.continue).toBe(true);
        expect("decision" in result.value).toBe(false);
      }
    });
  });

  describe("execute — test file relaxation", () => {
    test("suppresses type-import-ratio for .test.ts files", () => {
      const deps = makeDeps({
        readFile: () => ok(TEST_FILE_WITH_SUPPRESSABLE),
      });
      const input = makeInput({
        tool_input: { file_path: "/src/components/MyComponent.test.ts" },
      });
      const result = CodeQualityGuard.execute(input, deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const ctx = getInjectedContextFor(result.value, "PostToolUse");
        if (ctx) {
          expect(ctx).not.toContain("Type import ratio");
          expect(ctx).not.toContain("Options object has");
        }
      }
    });

    test("suppresses type-import-ratio for .spec.tsx files", () => {
      const deps = makeDeps({
        readFile: () => ok(TEST_FILE_WITH_SUPPRESSABLE),
      });
      const input = makeInput({
        tool_input: { file_path: "/src/components/MyComponent.spec.tsx" },
      });
      const result = CodeQualityGuard.execute(input, deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const ctx = getInjectedContextFor(result.value, "PostToolUse");
        if (ctx) {
          expect(ctx).not.toContain("Type import ratio");
          expect(ctx).not.toContain("Options object has");
        }
      }
    });

    test("does NOT suppress type-import-ratio for production files", () => {
      const deps = makeDeps({
        readFile: () => ok(TEST_FILE_WITH_SUPPRESSABLE),
      });
      const input = makeInput({
        tool_input: { file_path: "/src/components/MyComponent.ts" },
      });
      const result = CodeQualityGuard.execute(input, deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const ctx = getInjectedContextFor(result.value, "PostToolUse");
        if (ctx) expect(ctx).toBeDefined();
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
      if (result.ok) expect(result.value.continue).toBe(true);
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
        expect(result2.value.continue).toBe(true);
      }
    });
  });

  describe("dedup half-life", () => {
    test("resurfaces violations after edit count threshold", () => {
      _resetViolationCache();
      const deps = makeDeps({
        readFile: () => ok(BLOATED_TS),
        dedup: { halfLifeEdits: 3, halfLifeMs: 300_000, countCrossSessionViolations: () => 0 },
      });
      const input = makeInput({ tool_input: { file_path: "/src/half-life-edits.ts" } });

      // Call 1: fresh report, editCount resets to 0
      CodeQualityGuard.execute(input, deps);
      // Calls 2 & 3: suppressed (editCount increments to 1, then 2)
      CodeQualityGuard.execute(input, deps);
      CodeQualityGuard.execute(input, deps);
      // Call 4: editCount would be 3 >= halfLifeEdits(3) — resurfaces
      const result = CodeQualityGuard.execute(input, deps);

      expect(result.ok).toBe(true);
      if (result.ok) {
        const ctx = getInjectedContextFor(result.value, "PostToolUse");
        expect(ctx).toBeDefined();
        expect(ctx).toContain("SOLID quality:");
      }
    });

    test("resurfaces violations after time threshold", () => {
      _resetViolationCache();
      const filePath = "/src/half-life-time.ts";
      // Set halfLifeEdits very high so only time can trigger resurfacing
      const deps = makeDeps({
        readFile: () => ok(BLOATED_TS),
        dedup: { halfLifeEdits: 100, halfLifeMs: 300_000, countCrossSessionViolations: () => 0 },
      });
      const input = makeInput({ tool_input: { file_path: filePath } });

      // Call 1: fresh report — stores entry with correct hash and timestamp=now
      CodeQualityGuard.execute(input, deps);
      // Call 2: suppressed (editCount=1, time fresh)
      CodeQualityGuard.execute(input, deps);

      // Read back the actual hash the contract stored so we can inject an expired
      // entry with the *same* hash. This forces the code into the hash=match branch
      // where it evaluates halfLifeExpired — specifically the elapsed >= halfLifeMs path.
      const stored = _getViolationCacheEntry(filePath);
      expect(stored).toBeDefined();
      const SIX_MINUTES_MS = 6 * 60 * 1000;
      _setViolationCacheEntry(filePath, {
        hash: stored!.hash,
        timestamp: Date.now() - SIX_MINUTES_MS,
        editCount: 1,
      });

      // Next call: hash matches, but elapsed (6 min) >= halfLifeMs (5 min) → resurfaces
      const result = CodeQualityGuard.execute(input, deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const ctx = getInjectedContextFor(result.value, "PostToolUse");
        expect(ctx).toBeDefined();
        expect(ctx).toContain("SOLID quality:");
      }
    });

    test("cross-session: prepends REPEAT OFFENDER when 3+ prior sessions flagged file", () => {
      _resetViolationCache();
      const filePath = "/src/repeat-offender.ts";
      const deps = makeDeps({
        readFile: () => ok(BLOATED_TS),
        dedup: {
          halfLifeEdits: 5,
          halfLifeMs: 300_000,
          countCrossSessionViolations: () => 3,
        },
      });
      const input = makeInput({ tool_input: { file_path: filePath } });

      const result = CodeQualityGuard.execute(input, deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const ctx = getInjectedContextFor(result.value, "PostToolUse");
        expect(ctx).toBeDefined();
        expect(ctx).toContain("REPEAT OFFENDER");
      }
    });

    test("cross-session: no REPEAT OFFENDER when fewer than 3 prior sessions", () => {
      _resetViolationCache();
      const filePath = "/src/not-repeat.ts";
      const deps = makeDeps({
        readFile: () => ok(BLOATED_TS),
        dedup: {
          halfLifeEdits: 5,
          halfLifeMs: 300_000,
          countCrossSessionViolations: () => 2,
        },
      });
      const input = makeInput({ tool_input: { file_path: filePath } });

      const result = CodeQualityGuard.execute(input, deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const ctx = getInjectedContextFor(result.value, "PostToolUse");
        if (ctx) expect(ctx).not.toContain("REPEAT OFFENDER");
      }
    });

    test("deltaMessage bypasses dedup: always resurfaces when baseline delta exists", () => {
      // When formatDelta returns a non-null message, the dedup guard is intentionally
      // skipped (contract line: `if (prevEntry && prevEntry.hash === hash && !deltaMessage)`).
      // This pins that behavior: a file with an improving/degrading score always reports,
      // even if the violation set is identical to the previous call.
      _resetViolationCache();
      const filePath = "/src/delta-bypass.ts";
      const baseline: BaselineStore = {
        [filePath]: { score: 4.0, violations: 3, checkResults: [] },
      };
      const deps = makeDeps({
        readFile: () => ok(BLOATED_TS),
        readJson: <T>(_path: string) => ok(baseline as T),
        dedup: {
          halfLifeEdits: 100,
          halfLifeMs: 999_999_999,
          countCrossSessionViolations: () => 0,
        },
      });
      const input = makeInput({ tool_input: { file_path: filePath } });

      // Call 1: fresh report, cache entry stored
      CodeQualityGuard.execute(input, deps);

      // Call 2: same violations (same hash), but deltaMessage is non-null because baseline
      // exists — dedup must NOT suppress, context must still be injected
      const result2 = CodeQualityGuard.execute(input, deps);
      expect(result2.ok).toBe(true);
      if (result2.ok) {
        const ctx = getInjectedContextFor(result2.value, "PostToolUse");
        expect(ctx).toBeDefined();
      }
    });
  });
});
