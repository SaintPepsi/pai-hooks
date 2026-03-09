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

import type { HookContract } from "../core/contract";
import type { ToolHookInput } from "../core/types/hook-inputs";
import type { ContinueOutput } from "../core/types/hook-outputs";
import { ok, type Result } from "../core/result";
import type { PaiError } from "../core/error";
import { fileExists, readFile, readJson } from "../core/adapters/fs";
import { getLanguageProfile, isScorableFile } from "../core/language-profiles";
import { scoreFile, formatAdvisory, formatDelta, type QualityScore } from "../core/quality-scorer";
import { logSignal, defaultSignalLoggerDeps, type SignalLoggerDeps } from "../lib/signal-logger";
import { join } from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BaselineStore {
  [filePath: string]: { score: number; violations: number; checkResults: QualityScore["checkResults"] };
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

function getFilePath(input: ToolHookInput): string | null {
  if (typeof input.tool_input === "object" && input.tool_input !== null) {
    return (input.tool_input.file_path as string) ?? null;
  }
  return null;
}

function getBaselineScore(
  filePath: string,
  sessionId: string,
  deps: CodeQualityGuardDeps,
): QualityScore | null {
  const baselinePath = join(deps.signal.baseDir, "MEMORY", "STATE", `quality-baselines-${sessionId}.json`);
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
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const CodeQualityGuard: HookContract<
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

  execute(
    input: ToolHookInput,
    deps: CodeQualityGuardDeps,
  ): Result<ContinueOutput, PaiError> {
    const filePath = getFilePath(input)!;

    // Read the file content after the edit
    const contentResult = deps.readFile(filePath);
    if (!contentResult.ok) {
      deps.stderr(`[CodeQualityGuard] Could not read ${filePath}, skipping`);
      return ok({ type: "continue", continue: true });
    }

    const profile = deps.getLanguageProfile(filePath);
    if (!profile) {
      return ok({ type: "continue", continue: true });
    }

    const result = deps.scoreFile(contentResult.value, profile, filePath);

    // Phase 7d: QualityDelta — check for baseline and compute delta
    const baseline = getBaselineScore(filePath, input.session_id, deps);
    let deltaMessage: string | null = null;
    if (baseline) {
      deltaMessage = deps.formatDelta(baseline, result, filePath);
    }

    // Only inject context if there are violations or a meaningful delta
    const advisory = deps.formatAdvisory(result, filePath);

    const hasViolations = result.violations.length > 0;
    const hasAdvisory = !!advisory || !!deltaMessage;

    if (hasAdvisory) {
      deps.stderr(`[CodeQualityGuard] ${filePath}: ${result.score}/10 (${result.violations.length} violations)`);
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
        violations: result.violations.map(v => ({
          check: v.check,
          category: v.category,
          severity: v.severity,
          message: v.message,
        })),
      }),
    });

    if (!hasAdvisory) {
      return ok({ type: "continue", continue: true });
    }

    const parts: string[] = [];
    if (deltaMessage) parts.push(deltaMessage);
    if (advisory) parts.push(advisory);

    return ok({
      type: "continue",
      continue: true,
      additionalContext: parts.join("\n"),
    });
  },

  defaultDeps,
};
