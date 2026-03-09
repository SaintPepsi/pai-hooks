/**
 * CodeQualityBaseline Contract — Store quality baseline on file Read.
 *
 * PostToolUse hook that fires after Read operations. Scores the file
 * and stores the baseline for later delta comparison by CodeQualityGuard.
 * Only injects context for files with significant pre-existing violations
 * (score below 6.0).
 *
 * Skips small files (under 50 lines), non-source files, and test files.
 */

import type { HookContract } from "../core/contract";
import type { ToolHookInput } from "../core/types/hook-inputs";
import type { ContinueOutput } from "../core/types/hook-outputs";
import { ok, type Result } from "../core/result";
import type { PaiError } from "../core/error";
import { fileExists, readFile, readJson, writeJson, ensureDir } from "../core/adapters/fs";
import { getLanguageProfile, isScorableFile } from "../core/language-profiles";
import { scoreFile, formatAdvisory, type QualityScore } from "../core/quality-scorer";
import { join, dirname } from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BaselineEntry {
  score: number;
  violations: number;
  checkResults: QualityScore["checkResults"];
  timestamp: string;
}

interface BaselineStore {
  [filePath: string]: BaselineEntry;
}

export interface CodeQualityBaselineDeps {
  fileExists: (path: string) => boolean;
  readFile: (path: string) => Result<string, PaiError>;
  readJson: <T = unknown>(path: string) => Result<T, PaiError>;
  writeJson: (path: string, data: unknown) => Result<void, PaiError>;
  ensureDir: (path: string) => Result<void, PaiError>;
  getLanguageProfile: typeof getLanguageProfile;
  isScorableFile: typeof isScorableFile;
  scoreFile: typeof scoreFile;
  formatAdvisory: typeof formatAdvisory;
  getTimestamp: () => string;
  baseDir: string;
  stderr: (msg: string) => void;
}

// ─── Pure Logic ──────────────────────────────────────────────────────────────

const MIN_LINES = 50;
const LOW_SCORE_THRESHOLD = 6.0;

function getFilePath(input: ToolHookInput): string | null {
  if (typeof input.tool_input === "object" && input.tool_input !== null) {
    return (input.tool_input.file_path as string) ?? null;
  }
  return null;
}

function isTestFile(filePath: string): boolean {
  const name = filePath.split("/").pop() ?? "";
  return (
    name.includes(".test.") ||
    name.includes(".spec.") ||
    name.includes("_test.") ||
    name.includes("_spec.") ||
    filePath.includes("__tests__/") ||
    filePath.includes("/test/") ||
    filePath.includes("/tests/")
  );
}

function countLines(content: string): number {
  return content.split("\n").length;
}

function getBaselinePath(sessionId: string, baseDir: string): string {
  return join(baseDir, "MEMORY", "STATE", `quality-baselines-${sessionId}.json`);
}

// ─── Contract ────────────────────────────────────────────────────────────────

const BASE_DIR = process.env.PAI_DIR || join(process.env.HOME!, ".claude");

const defaultDeps: CodeQualityBaselineDeps = {
  fileExists,
  readFile,
  readJson,
  writeJson,
  ensureDir,
  getLanguageProfile,
  isScorableFile,
  scoreFile,
  formatAdvisory,
  getTimestamp: () => new Date().toISOString(),
  baseDir: BASE_DIR,
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const CodeQualityBaseline: HookContract<
  ToolHookInput,
  ContinueOutput,
  CodeQualityBaselineDeps
> = {
  name: "CodeQualityBaseline",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    if (input.tool_name !== "Read") return false;
    const filePath = getFilePath(input);
    if (!filePath) return false;
    if (!isScorableFile(filePath)) return false;
    if (isTestFile(filePath)) return false;
    return true;
  },

  execute(
    input: ToolHookInput,
    deps: CodeQualityBaselineDeps,
  ): Result<ContinueOutput, PaiError> {
    const filePath = getFilePath(input)!;

    // Read the file content
    const contentResult = deps.readFile(filePath);
    if (!contentResult.ok) {
      deps.stderr(`[CodeQualityBaseline] Could not read ${filePath}, skipping`);
      return ok({ type: "continue", continue: true });
    }

    const content = contentResult.value;

    // Skip small files
    if (countLines(content) < MIN_LINES) {
      return ok({ type: "continue", continue: true });
    }

    const profile = deps.getLanguageProfile(filePath);
    if (!profile) {
      return ok({ type: "continue", continue: true });
    }

    // Score the file
    const result = deps.scoreFile(content, profile, filePath);

    // Store baseline
    const baselinePath = getBaselinePath(input.session_id, deps.baseDir);
    deps.ensureDir(dirname(baselinePath));

    let store: BaselineStore = {};
    const existingResult = deps.readJson<BaselineStore>(baselinePath);
    if (existingResult.ok) {
      store = existingResult.value;
    }

    store[filePath] = {
      score: result.score,
      violations: result.violations.length,
      checkResults: result.checkResults,
      timestamp: deps.getTimestamp(),
    };

    deps.writeJson(baselinePath, store);

    deps.stderr(`[CodeQualityBaseline] ${filePath}: ${result.score}/10 (baseline stored)`);

    // Only inject context for low-scoring files
    if (result.score < LOW_SCORE_THRESHOLD) {
      const advisory = deps.formatAdvisory(result, filePath);
      if (advisory) {
        return ok({
          type: "continue",
          continue: true,
          additionalContext: `Note: Pre-existing quality concerns detected.\n${advisory}`,
        });
      }
    }

    return ok({ type: "continue", continue: true });
  },

  defaultDeps,
};
