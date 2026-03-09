/**
 * TestObligationStateMachine — Two cooperating contracts for test enforcement.
 *
 * TestObligationTracker (PostToolUse): When Edit/Write touches a code file
 * (not test files, not non-code files), sets a tests-pending flag via
 * filesystem. When Bash runs a test command, clears the flag.
 *
 * TestObligationEnforcer (Stop): If the tests-pending flag still exists
 * when the session ends, checks whether each pending file has an existing
 * test file (.test. or .spec. variant). Files without tests get a "write
 * and run tests" instruction; files with tests get a "run tests" instruction.
 */

import type { HookContract } from "@hooks/core/contract";
import type { ToolHookInput, StopInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput, BlockOutput, SilentOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { writeFile, readFile, fileExists as fsFileExists, removeFile } from "@hooks/core/adapters/fs";
import { isScorableFile } from "@hooks/core/language-profiles";
import { pickNarrative } from "@hooks/lib/narrative-reader";
import { join } from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TestObligationDeps {
  stateDir: string;
  fileExists: (path: string) => boolean;
  readPending: (path: string) => string[];
  writePending: (path: string, files: string[]) => void;
  removeFlag: (path: string) => void;
  readBlockCount: (path: string) => number;
  writeBlockCount: (path: string, count: number) => void;
  writeReview: (path: string, content: string) => void;
  stderr: (msg: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TEST_FILE_PATTERNS = [/\.test\.\w+$/, /\.spec\.\w+$/, /__tests__\//];

const TEST_COMMANDS = [
  /\bbun\s+test\b/,
  /\bnpm\s+test\b/,
  /\bnpx\s+(vitest|jest)\b/,
  /\bvitest\b/,
  /\bjest\b/,
  /\bpytest\b/,
  /\bgo\s+test\b/,
  /\bcargo\s+test\b/,
];

function isNonTestCodeFile(filePath: string): boolean {
  if (!isScorableFile(filePath)) return false;
  return !TEST_FILE_PATTERNS.some((pattern) => pattern.test(filePath));
}

function isTestCommand(command: string): boolean {
  return TEST_COMMANDS.some((pattern) => pattern.test(command));
}

/** Extract source file paths that a test command covers. Returns null for bare/full-suite commands. */
function extractTestedSourceFiles(command: string): string[] | null {
  // Match test file paths in the command (e.g., "bun test src/foo.test.ts")
  const testFilePattern = /\S+\.(?:test|spec)\.\w+/g;
  const matches = command.match(testFilePattern);
  if (!matches || matches.length === 0) return null;

  return matches.map((testFile) => {
    // Strip .test. or .spec. to derive source file: foo.test.ts → foo.ts
    return testFile.replace(/\.(?:test|spec)\./, ".");
  });
}

/** Check if a pending file matches a tested source file (by ending match). */
function pendingMatchesSource(pendingFile: string, sourceFile: string): boolean {
  return pendingFile.endsWith(sourceFile) || pendingFile.endsWith("/" + sourceFile);
}

function getFilePath(input: ToolHookInput): string | null {
  if (typeof input.tool_input !== "object" || input.tool_input === null) return null;
  return (input.tool_input as Record<string, unknown>).file_path as string ?? null;
}

function getCommand(input: ToolHookInput): string | null {
  if (typeof input.tool_input !== "object" || input.tool_input === null) return null;
  return (input.tool_input as Record<string, unknown>).command as string ?? null;
}

function pendingPath(stateDir: string, sessionId: string): string {
  return join(stateDir, `tests-pending-${sessionId}.json`);
}

function blockCountPath(stateDir: string, sessionId: string): string {
  return join(stateDir, `tests-block-count-${sessionId}.txt`);
}

const MAX_BLOCKS = 2;

function buildBlockLimitReview(obligationType: string, pendingFiles: string[], blockCount: number): string {
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

/** Derive .test. and .spec. file paths from a source file path. */
function deriveTestPaths(sourcePath: string): string[] {
  const dotIndex = sourcePath.lastIndexOf(".");
  if (dotIndex === -1) return [];
  const base = sourcePath.slice(0, dotIndex);
  const ext = sourcePath.slice(dotIndex);
  return [`${base}.test${ext}`, `${base}.spec${ext}`];
}

/** Check if any test file variant exists for a source file. */
function hasTestFile(sourcePath: string, fileExists: (path: string) => boolean): boolean {
  return deriveTestPaths(sourcePath).some(fileExists);
}

// ─── Default Deps ────────────────────────────────────────────────────────────

function getStateDir(): string {
  const paiDir = process.env.PAI_DIR || join(process.env.HOME!, ".claude");
  return join(paiDir, "MEMORY", "STATE", "test-obligation");
}

const defaultDeps: TestObligationDeps = {
  stateDir: getStateDir(),
  fileExists: (path: string) => fsFileExists(path),
  readPending: (path: string) => {
    const result = readFile(path);
    if (!result.ok) return [];
    const parsed = JSON.parse(result.value);
    return Array.isArray(parsed) ? parsed : [];
  },
  writePending: (path: string, files: string[]) => {
    writeFile(path, JSON.stringify(files));
  },
  removeFlag: (path: string) => {
    removeFile(path);
  },
  readBlockCount: (path: string) => {
    const result = readFile(path);
    if (!result.ok) return 0;
    const n = parseInt(result.value.trim(), 10);
    return isNaN(n) ? 0 : n;
  },
  writeBlockCount: (path: string, count: number) => {
    writeFile(path, String(count));
  },
  writeReview: (path: string, content: string) => {
    writeFile(path, content);
  },
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

// ─── Contract 1: TestObligationTracker ───────────────────────────────────────

export const TestObligationTracker: HookContract<
  ToolHookInput,
  ContinueOutput,
  TestObligationDeps
> = {
  name: "TestObligationTracker",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    if (input.tool_name === "Bash") return true;

    if (input.tool_name === "Edit" || input.tool_name === "Write") {
      const filePath = getFilePath(input);
      if (!filePath) return false;
      return isNonTestCodeFile(filePath);
    }

    return false;
  },

  execute(
    input: ToolHookInput,
    deps: TestObligationDeps,
  ): Result<ContinueOutput, PaiError> {
    const flagFile = pendingPath(deps.stateDir, input.session_id);

    // Bash: check if test command, clear matching files or all
    if (input.tool_name === "Bash") {
      const command = getCommand(input);
      if (command && isTestCommand(command) && deps.fileExists(flagFile)) {
        const testedSources = extractTestedSourceFiles(command);

        if (testedSources === null) {
          // Bare test command (e.g. "bun test") — clear all
          deps.removeFlag(flagFile);
          deps.stderr("[TestObligationTracker] Full test suite run — clearing all pending");
        } else {
          // Specific test file — clear only matching pending files
          const pending = deps.readPending(flagFile);
          const remaining = pending.filter(
            (p) => !testedSources.some((s) => pendingMatchesSource(p, s)),
          );

          if (remaining.length === 0) {
            deps.removeFlag(flagFile);
            deps.stderr("[TestObligationTracker] All pending files tested — clearing flag");
          } else {
            deps.writePending(flagFile, remaining);
            deps.stderr(`[TestObligationTracker] Cleared tested files, ${remaining.length} still pending`);
          }
        }
      }
      return ok({ type: "continue", continue: true });
    }

    // Edit/Write: add file to pending list
    const filePath = getFilePath(input);
    if (!filePath) {
      return ok({ type: "continue", continue: true });
    }

    const pending = deps.readPending(flagFile);
    if (!pending.includes(filePath)) {
      pending.push(filePath);
    }
    deps.writePending(flagFile, pending);
    deps.stderr(`[TestObligationTracker] Code modified: ${filePath} — tests pending`);

    return ok({ type: "continue", continue: true });
  },

  defaultDeps,
};

// ─── Contract 2: TestObligationEnforcer ──────────────────────────────────────

export const TestObligationEnforcer: HookContract<
  StopInput,
  BlockOutput | SilentOutput,
  TestObligationDeps
> = {
  name: "TestObligationEnforcer",
  event: "Stop",

  accepts(_input: StopInput): boolean {
    return true;
  },

  execute(
    input: StopInput,
    deps: TestObligationDeps,
  ): Result<BlockOutput | SilentOutput, PaiError> {
    const flagFile = pendingPath(deps.stateDir, input.session_id);

    if (!deps.fileExists(flagFile)) {
      return ok({ type: "silent" });
    }

    const pending = deps.readPending(flagFile);
    if (pending.length === 0) {
      return ok({ type: "silent" });
    }

    // Block limit: after MAX_BLOCKS attempts, write review and release
    const countFile = blockCountPath(deps.stateDir, input.session_id);
    const blockCount = deps.readBlockCount(countFile);

    if (blockCount >= MAX_BLOCKS) {
      const reviewPath = join(deps.stateDir, `review-${input.session_id}.md`);
      const review = buildBlockLimitReview("test", pending, blockCount);
      deps.writeReview(reviewPath, review);
      deps.removeFlag(flagFile);
      deps.removeFlag(countFile);
      deps.stderr(`[TestObligationEnforcer] Block limit (${MAX_BLOCKS}) reached for ${pending.length} file(s). Review written. Releasing session.`);
      return ok({ type: "silent" });
    }

    const needsWriting: string[] = [];
    const needsRunning: string[] = [];

    for (const file of pending) {
      if (hasTestFile(file, deps.fileExists)) {
        needsRunning.push(file);
      } else {
        needsWriting.push(file);
      }
    }

    const opener = pickNarrative("TestObligationEnforcer", pending.length);
    const sections: string[] = [];

    if (needsWriting.length > 0) {
      const list = needsWriting.map((f) => `  - ${f}`).join("\n");
      sections.push(`Write and run tests for (no test file exists):\n${list}`);
    }

    if (needsRunning.length > 0) {
      const list = needsRunning.map((f) => `  - ${f}`).join("\n");
      sections.push(`Run existing tests for:\n${list}`);
    }

    const reason = `${opener}\n\n${sections.join("\n\n")}`;

    deps.writeBlockCount(countFile, blockCount + 1);
    deps.stderr(`[TestObligationEnforcer] Block ${blockCount + 1}/${MAX_BLOCKS}: ${pending.length} file(s) modified without tests`);

    return ok({ type: "block", decision: "block", reason });
  },

  defaultDeps,
};
