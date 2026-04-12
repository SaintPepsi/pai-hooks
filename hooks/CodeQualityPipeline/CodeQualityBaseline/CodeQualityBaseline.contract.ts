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

import { dirname, join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { ensureDir, fileExists, readFile, readJson, writeJson } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { getLanguageProfile, isScorableFile } from "@hooks/core/language-profiles";
import { formatAdvisory, type QualityScore, scoreFile } from "@hooks/core/quality-scorer";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";
import { extractSvelteScript, isSvelteFile } from "@hooks/lib/svelte-utils";
import { getFilePath } from "@hooks/lib/tool-input";

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
  readFile: (path: string) => Result<string, ResultError>;
  readJson: <T = unknown>(path: string) => Result<T, ResultError>;
  writeJson: (path: string, data: unknown) => Result<void, ResultError>;
  ensureDir: (path: string) => Result<void, ResultError>;
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
  baseDir: getPaiDir(),
  stderr: defaultStderr,
};

export const CodeQualityBaseline: SyncHookContract<ToolHookInput, CodeQualityBaselineDeps> = {
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
  ): Result<SyncHookJSONOutput, ResultError> {
    const filePath = getFilePath(input)!;

    // Read the file content
    const contentResult = deps.readFile(filePath);
    if (!contentResult.ok) {
      deps.stderr(`[CodeQualityBaseline] Could not read ${filePath}, skipping`);
      return ok({ continue: true });
    }

    let content = contentResult.value;

    // For Svelte files, only score the <script lang="ts"> block
    if (isSvelteFile(filePath)) {
      const scriptContent = extractSvelteScript(content);
      if (!scriptContent) {
        return ok({ continue: true });
      }
      content = scriptContent;
    }

    // Skip small files
    if (countLines(content) < MIN_LINES) {
      return ok({ continue: true });
    }

    const profile = deps.getLanguageProfile(filePath);
    if (!profile) {
      return ok({ continue: true });
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
          continue: true,
          hookSpecificOutput: {
            hookEventName: "PostToolUse",
            additionalContext: `Note: Pre-existing quality concerns detected.\n${advisory}`,
          },
        });
      }
    }

    return ok({ continue: true });
  },

  defaultDeps,
};
