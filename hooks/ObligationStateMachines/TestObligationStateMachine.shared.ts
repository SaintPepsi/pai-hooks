/**
 * TestObligationStateMachine — Shared types, helpers, and default deps.
 * Used by both TestObligationTracker and TestObligationEnforcer.
 */

import { basename, dirname, join } from "node:path";
import {
  fileExists as fsFileExists,
  readDir as fsReadDir,
  readFile,
  readJson,
  removeFile,
  writeFile,
} from "@hooks/core/adapters/fs";
import { isScorableFile } from "@hooks/core/language-profiles";
import { readHookConfig } from "@hooks/lib/hook-config";
import type { ObligationDeps } from "@hooks/lib/obligation-machine";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Deps for scanning nearby test files for imports of a source file. */
export interface ImportScanDeps {
  /** Return filenames (not full paths) in a directory, or [] on error. */
  readDir: (dirPath: string) => string[];
  /** Return file content as a string, or null on error. */
  readFileContent: (filePath: string) => string | null;
}

// TestObligationDeps extends ObligationDeps with import-scan capabilities.
export type TestObligationDeps = ObligationDeps & ImportScanDeps;

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

/**
 * Derive candidate test file paths from a source file path.
 *
 * Handles two pai-hooks conventions for `.contract.ts` files:
 *   1. `Foo.contract.ts` → `Foo.test.ts` (the majority convention — drop `.contract`)
 *   2. `Foo.contract.ts` → `Foo.contract.test.ts` (explicit — keep `.contract`)
 *
 * Also checks `.spec.ts` variants, a `Foo.coverage.test.ts` sidecar for
 * hooks that split coverage-specific tests out of the main test file (e.g.
 * GitAutoSync), and `FooTest.php` for PHP files.
 */
export function deriveTestPaths(sourcePath: string): string[] {
  const dotIndex = sourcePath.lastIndexOf(".");
  if (dotIndex === -1) return [];
  const base = sourcePath.slice(0, dotIndex);
  const ext = sourcePath.slice(dotIndex);
  const paths = [`${base}.test${ext}`, `${base}.spec${ext}`, `${base}.coverage.test${ext}`];
  // For `.contract.ts` sources, also check the "strip .contract" convention
  // that most pai-hooks contracts use: `Foo.contract.ts` → `Foo.test.ts`.
  if (base.endsWith(".contract")) {
    const stripped = base.slice(0, -".contract".length);
    paths.push(
      `${stripped}.test${ext}`,
      `${stripped}.spec${ext}`,
      `${stripped}.coverage.test${ext}`,
    );
  }
  if (ext === ".php") {
    paths.push(`${base}Test${ext}`);
  }
  return paths;
}

/** Check if any test file variant exists for a source file. */
export function hasTestFile(sourcePath: string, fileExists: (path: string) => boolean): boolean {
  return deriveTestPaths(sourcePath).some(fileExists);
}

/**
 * Scan the same directory and parent directory for *.test.ts / *.spec.ts files
 * that import the given source file. Returns the path of the first match, or null.
 *
 * The regex matches:
 *   import ... from '...basename...'
 *   require('...basename...')
 *
 * For `.contract.ts` sources the `.contract` suffix is stripped when deriving
 * the basename to match, mirroring the convention in `deriveTestPaths`.
 */
export function findImportingTestFile(
  sourcePath: string,
  deps: ImportScanDeps,
): string | null {
  // Derive the import name the test file would use. Strip extension, then strip
  // `.contract` suffix when present (matches the co-located test convention).
  const dotIndex = sourcePath.lastIndexOf(".");
  const withoutExt = dotIndex === -1 ? sourcePath : sourcePath.slice(0, dotIndex);
  const stem = withoutExt.endsWith(".contract")
    ? withoutExt.slice(0, -".contract".length)
    : withoutExt;
  // Use the final path component as the import basename to match against.
  const importBasename = basename(stem).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importPattern = new RegExp(
    `from\\s+['"][^'"]*${importBasename}['"]|require\\(['"][^'"]*${importBasename}['"]\\)`,
  );

  const testFilePattern = /\.(?:test|spec)\.\w+$/;
  const sourceDir = dirname(sourcePath);
  const parentDir = dirname(sourceDir);

  for (const dir of [sourceDir, parentDir]) {
    const entries = deps.readDir(dir);
    for (const entry of entries) {
      if (!testFilePattern.test(entry)) continue;
      const fullPath = join(dir, entry);
      const content = deps.readFileContent(fullPath);
      if (content !== null && importPattern.test(content)) {
        return fullPath;
      }
    }
  }
  return null;
}

// ─── Exclude Pattern Helpers ──────────────────────────────────────────────────

/** Read excludePatterns from settings.json hookConfig.testObligation.excludePatterns. */
export function readTestExcludePatterns(settingsPath?: string): string[] {
  const cfg = readHookConfig<{ excludePatterns?: string[] }>(
    "testObligation",
    undefined,
    settingsPath,
  );
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
  readDir: (dirPath: string) => {
    const result = fsReadDir(dirPath);
    return result.ok ? result.value : [];
  },
  readFileContent: (filePath: string) => {
    const result = readFile(filePath);
    return result.ok ? result.value : null;
  },
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
