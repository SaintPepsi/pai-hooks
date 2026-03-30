/**
 * TestObligationStateMachine — Shared types, helpers, and default deps.
 * Used by both TestObligationTracker and TestObligationEnforcer.
 */

import { join } from "node:path";
import {
  fileExists as fsFileExists,
  readFile,
  readJson,
  removeFile,
  writeFile,
} from "@hooks/core/adapters/fs";
import { jsonParseFailed } from "@hooks/core/error";
import { isScorableFile } from "@hooks/core/language-profiles";
import { tryCatch } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ObligationDeps } from "@hooks/lib/obligation-machine";
import { getCommand, getFilePath } from "@hooks/lib/tool-input";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";
import { readHookConfig } from "@hooks/lib/hook-config";

// ─── Types ────────────────────────────────────────────────────────────────────

// TestObligationDeps is ObligationDeps from lib/obligation-machine.ts
export type TestObligationDeps = ObligationDeps;

/** Narrow extension used only by TestObligationTracker (not the enforcer). */
export interface TestTrackerExcludeDeps {
  getExcludePatterns: () => string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_FILE_PATTERNS = [
  /\.test\.\w+$/,
  /\.spec\.\w+$/,
  /__tests__\//,
  /Test\.php$/,
  /\/tests\/(?:Feature|Unit)\//,
];

const TEST_COMMANDS = [
  /\bbun\s+test\b/,
  /\bnpm\s+test\b/,
  /\bnpx\s+(vitest|jest)\b/,
  /\bvitest\b/,
  /\bjest\b/,
  /\bpytest\b/,
  /\bgo\s+test\b/,
  /\bcargo\s+test\b/,
  /\bphpunit\b/,
  /\bsail\s+(?:phpunit|test)\b/,
  /\bartisan\s+test\b/,
];

export function isNonTestCodeFile(filePath: string): boolean {
  if (!isScorableFile(filePath)) return false;
  return !TEST_FILE_PATTERNS.some((pattern) => pattern.test(filePath));
}

export function isTestCommand(command: string): boolean {
  return TEST_COMMANDS.some((pattern) => pattern.test(command));
}

/** Extract source file paths that a test command covers. Returns null for bare/full-suite commands. */
export function extractTestedSourceFiles(command: string): string[] | null {
  const testFilePattern = /\S+\.(?:test|spec)\.\w+/g;
  const matches = command.match(testFilePattern);
  if (!matches || matches.length === 0) return null;
  return matches.map((testFile) => testFile.replace(/\.(?:test|spec)\./, "."));
}

/** Check if a pending file matches a tested source file (by ending match). */
export function pendingMatchesSource(pendingFile: string, sourceFile: string): boolean {
  return pendingFile.endsWith(sourceFile) || pendingFile.endsWith(`/${sourceFile}`);
}


export function pendingPath(stateDir: string, sessionId: string): string {
  return join(stateDir, `tests-pending-${sessionId}.json`);
}

export function blockCountPath(stateDir: string, sessionId: string): string {
  return join(stateDir, `tests-block-count-${sessionId}.txt`);
}

export const MAX_BLOCKS = 2;

export function buildBlockLimitReview(
  obligationType: string,
  pendingFiles: string[],
  blockCount: number,
): string {
  const timestamp = new Date().toISOString();
  const fileList = pendingFiles.map((f) => `- ${f}`).join("\n");
  return `# ${obligationType === "test" ? "Test" : "Doc"} Obligation Review

**Generated:** ${timestamp}
**Block attempts:** ${blockCount}
**Outcome:** Session released after reaching block limit

## Unresolved Files

${fileList}

## What Happened

The ${obligationType} obligation enforcer blocked session end ${blockCount} times for the files above.
The AI addressed the concern but did not resolve the pending state (likely because the files
cannot be ${obligationType === "test" ? "tested with standard tooling" : "documented in the expected way"} or the obligation was a false positive).

## Action Items

- Review whether these files genuinely need ${obligationType === "test" ? "tests" : "documentation updates"}
- If not, consider adding them to an exclusion list
`;
}

/** Derive .test. and .spec. file paths from a source file path. Also derives FooTest.php for PHP files. */
export function deriveTestPaths(sourcePath: string): string[] {
  const dotIndex = sourcePath.lastIndexOf(".");
  if (dotIndex === -1) return [];
  const base = sourcePath.slice(0, dotIndex);
  const ext = sourcePath.slice(dotIndex);
  const paths = [`${base}.test${ext}`, `${base}.spec${ext}`];
  if (ext === ".php") {
    paths.push(`${base}Test${ext}`);
  }
  return paths;
}

/** Check if any test file variant exists for a source file. */
export function hasTestFile(sourcePath: string, fileExists: (path: string) => boolean): boolean {
  return deriveTestPaths(sourcePath).some(fileExists);
}

// ─── Exclude Pattern Helpers ──────────────────────────────────────────────────

/** Read excludePatterns from settings.json hookConfig.testObligation.excludePatterns. */
export function readTestExcludePatterns(settingsPath?: string): string[] {
  const cfg = readHookConfig<{ excludePatterns?: string[] }>("testObligation", undefined, settingsPath);
  return Array.isArray(cfg?.excludePatterns) ? cfg.excludePatterns : [];
}

/** Returns true if filePath matches any of the given glob patterns. */
export function matchesExcludePattern(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => new Bun.Glob(pattern).match(filePath));
}

// ─── Default Deps ─────────────────────────────────────────────────────────────

function getStateDir(baseDir: string): string {
  return join(baseDir, "MEMORY", "STATE", "test-obligation");
}

const stderr = (msg: string) => defaultStderr(msg);

export const defaultTrackerExcludeDeps: TestTrackerExcludeDeps = {
  getExcludePatterns: () => readTestExcludePatterns(),
};

export const defaultDeps: TestObligationDeps = {
  stateDir: getStateDir(getPaiDir()),
  fileExists: (path: string) => fsFileExists(path),
  readPending: (path: string) => {
    const result = readJson<unknown>(path);
    if (!result.ok) {
      if (fsFileExists(path)) {
        stderr(`[TestObligationTracker] corrupt state file, resetting: ${path}`);
      }
      return [];
    }
    return Array.isArray(result.value) ? (result.value as string[]) : [];
  },
  writePending: (path: string, files: string[]) => {
    const result = writeFile(path, JSON.stringify(files));
    if (!result.ok) {
      stderr(`[TestObligationTracker] write failed: ${result.error.message}`);
    }
  },
  removeFlag: (path: string) => {
    const result = removeFile(path);
    if (!result.ok) {
      stderr(`[TestObligationTracker] remove failed: ${result.error.message}`);
    }
  },
  readBlockCount: (path: string) => {
    const result = readFile(path);
    if (!result.ok) return 0;
    const n = parseInt(result.value.trim(), 10);
    return Number.isNaN(n) ? 0 : n;
  },
  writeBlockCount: (path: string, count: number) => {
    const result = writeFile(path, String(count));
    if (!result.ok) {
      stderr(`[TestObligationTracker] write block count failed: ${result.error.message}`);
    }
  },
  writeReview: (path: string, content: string) => {
    const result = writeFile(path, content);
    if (!result.ok) {
      stderr(`[TestObligationTracker] write review failed: ${result.error.message}`);
    }
  },
  stderr,
};
