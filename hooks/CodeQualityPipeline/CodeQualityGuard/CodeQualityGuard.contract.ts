/**
 * CodeQualityGuard Contract — SOLID quality feedback on Edit/Write.
 *
 * PostToolUse hook that fires after Edit and Write operations. Scores the
 * modified file for SOLID violations and injects advisory warnings as
 * additionalContext. Never blocks, never asks.
 *
 * When a baseline score exists (from CodeQualityBaseline), computes the
 * quality delta and reports directional change (Phase 7d: QualityDelta).
 */

import { join } from "node:path";
import { fileExists, readFile, readJson } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { getLanguageProfile, isScorableFile } from "@hooks/core/language-profiles";
import {
  formatAdvisory,
  formatDelta,
  type QualityScore,
  scoreFile,
} from "@hooks/core/quality-scorer";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { continueOk } from "@hooks/core/types/hook-outputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import { getFilePath } from "@hooks/lib/tool-input";
import {
  defaultSignalLoggerDeps,
  logSignal,
  type SignalLoggerDeps,
} from "@hooks/lib/signal-logger";
import { extractSvelteScript, isSvelteFile } from "@hooks/lib/svelte-utils";

// ─── Violation Dedup Cache ────────────────────────────────────────────────────

const reportedViolations = new Map<string, string>();

/** Test-only: reset the violation dedup cache so tests start with clean state. */
export function _resetViolationCache(): void {
  reportedViolations.clear();
}

function violationHash(violations: Array<{ check: string }>): string {
  return violations
    .map((v) => v.check)
    .sort()
    .join(",");
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface BaselineStore {
  [filePath: string]: {
    score: number;
    violations: number;
    checkResults: QualityScore["checkResults"];
  };
}

export interface CodeQualityGuardDeps {
  fileExists: (path: string) => boolean;
  readFile: (path: string) => Result<string, PaiError>;
  readJson: <T = unknown>(path: string) => Result<T, PaiError>;
  getLanguageProfile: typeof getLanguageProfile;
  isScorableFile: typeof isScorableFile;
  scoreFile: typeof scoreFile;
  formatAdvisory: typeof formatAdvisory;
  formatDelta: typeof formatDelta;
  signal: SignalLoggerDeps;
  stderr: (msg: string) => void;
}

// ─── Pure Logic ──────────────────────────────────────────────────────────────

const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const TEST_SUPPRESSED_CHECKS = new Set(["type-import-ratio", "options-object-width"]);

function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERN.test(filePath);
}

function getBaselineScore(
  filePath: string,
  sessionId: string,
  deps: CodeQualityGuardDeps,
): QualityScore | null {
  const baselinePath = join(
    deps.signal.baseDir,
    "MEMORY",
    "STATE",
    `quality-baselines-${sessionId}.json`,
  );
  const result = deps.readJson<BaselineStore>(baselinePath);
  if (!result.ok) return null;

  const entry = result.value[filePath];
  if (!entry) return null;

  return {
    score: entry.score,
    violations: [],
    checkResults: entry.checkResults ?? [],
  };
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: CodeQualityGuardDeps = {
  fileExists,
  readFile,
  readJson,
  getLanguageProfile,
  isScorableFile,
  scoreFile,
  formatAdvisory,
  formatDelta,
  signal: defaultSignalLoggerDeps,
  stderr: (msg) => process.stderr.write(`${msg}\n`),
};

export const CodeQualityGuard: SyncHookContract<
  ToolHookInput,
  ContinueOutput,
  CodeQualityGuardDeps
> = {
  name: "CodeQualityGuard",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    if (input.tool_name !== "Edit" && input.tool_name !== "Write") return false;
    const filePath = getFilePath(input);
    if (!filePath) return false;
    return isScorableFile(filePath);
  },

  execute(input: ToolHookInput, deps: CodeQualityGuardDeps): Result<ContinueOutput, PaiError> {
    const filePath = getFilePath(input)!;

    // Read the file content after the edit
    const contentResult = deps.readFile(filePath);
    if (!contentResult.ok) {
      deps.stderr(`[CodeQualityGuard] Could not read ${filePath}, skipping`);
      return ok(continueOk());
    }

    const profile = deps.getLanguageProfile(filePath);
    if (!profile) {
      return ok(continueOk());
    }

    // For Svelte files, only score the <script lang="ts"> block
    let contentToScore = contentResult.value;
    if (isSvelteFile(filePath)) {
      const scriptContent = extractSvelteScript(contentToScore);
      if (!scriptContent) {
        return ok(continueOk());
      }
      contentToScore = scriptContent;
    }

    const result = deps.scoreFile(contentToScore, profile, filePath);

    // Suppress false-positive checks for test files (type-import-ratio, options-object-width)
    if (isTestFile(filePath)) {
      result.violations = result.violations.filter((v) => !TEST_SUPPRESSED_CHECKS.has(v.check));
    }

    // Phase 7d: QualityDelta — check for baseline and compute delta
    const baseline = getBaselineScore(filePath, input.session_id, deps);
    let deltaMessage: string | null = null;
    if (baseline) {
      deltaMessage = deps.formatDelta(baseline, result, filePath);
    }

    // Dedup: suppress identical violation reports for same file within session
    const hash = violationHash(result.violations);
    const prevHash = reportedViolations.get(filePath);
    if (hash === prevHash && !deltaMessage) {
      // Same violations, no delta — skip context injection but still log
      logSignal(deps.signal, "quality-violations.jsonl", {
        session_id: input.session_id,
        hook: "CodeQualityGuard",
        event: "PostToolUse",
        tool: input.tool_name,
        file: filePath,
        outcome: "continue",
        score: result.score,
        deduplicated: true,
      });
      return ok(continueOk());
    }
    reportedViolations.set(filePath, hash);

    // Only inject context if there are violations or a meaningful delta
    const advisory = deps.formatAdvisory(result, filePath);

    const hasViolations = result.violations.length > 0;
    const hasAdvisory = !!advisory || !!deltaMessage;

    if (hasAdvisory) {
      deps.stderr(
        `[CodeQualityGuard] ${filePath}: ${result.score}/10 (${result.violations.length} violations)`,
      );
    } else {
      deps.stderr(`[CodeQualityGuard] ${filePath}: ${result.score}/10 (clean)`);
    }

    // Log every execution to JSONL for analysis
    logSignal(deps.signal, "quality-violations.jsonl", {
      session_id: input.session_id,
      hook: "CodeQualityGuard",
      event: "PostToolUse",
      tool: input.tool_name,
      file: filePath,
      outcome: "continue",
      score: result.score,
      ...(hasViolations && {
        violations: result.violations.map((v) => ({
          check: v.check,
          category: v.category,
          severity: v.severity,
          message: v.message,
        })),
      }),
    });

    if (!hasAdvisory) {
      return ok(continueOk());
    }

    const parts: string[] = [];
    if (deltaMessage) parts.push(deltaMessage);
    if (advisory) parts.push(advisory);

    return ok(continueOk(parts.join("\n")));
  },

  defaultDeps,
};
