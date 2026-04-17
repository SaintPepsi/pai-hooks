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
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { fileExists, readFile, readJson } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { getLanguageProfile, isScorableFile } from "@hooks/core/language-profiles";
import {
  formatAdvisory,
  formatDelta,
  type QualityScore,
  scoreFile,
} from "@hooks/core/quality-scorer";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { countCrossSessionViolations } from "@hooks/lib/jsonl-reader";
import { defaultStderr } from "@hooks/lib/paths";
import {
  defaultSignalLoggerDeps,
  logSignal,
  type SignalLoggerDeps,
} from "@hooks/lib/signal-logger";
import { extractSvelteScript, isSvelteFile } from "@hooks/lib/svelte-utils";
import { getFilePath } from "@hooks/lib/tool-input";

// ─── Violation Dedup Cache ────────────────────────────────────────────────────

interface ViolationCacheEntry {
  hash: string;
  timestamp: number;
  editCount: number;
}

const reportedViolations = new Map<string, ViolationCacheEntry>();

/** Test-only: reset the violation dedup cache so tests start with clean state. */
export function _resetViolationCache(): void {
  reportedViolations.clear();
}

/** Test-only: inject a cache entry directly to simulate prior edits or elapsed time. */
export function _setViolationCacheEntry(filePath: string, entry: ViolationCacheEntry): void {
  reportedViolations.set(filePath, entry);
}

/** Test-only: read a cache entry to retrieve the hash the contract stored. */
export function _getViolationCacheEntry(filePath: string): ViolationCacheEntry | undefined {
  return reportedViolations.get(filePath);
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

export interface DedupConfig {
  halfLifeEdits: number;
  halfLifeMs: number;
  countCrossSessionViolations: (baseDir: string, filePath: string, sessionId: string) => number;
}

export interface CodeQualityGuardDeps {
  fileExists: (path: string) => boolean;
  readFile: (path: string) => Result<string, ResultError>;
  readJson: <T = unknown>(path: string) => Result<T, ResultError>;
  getLanguageProfile: typeof getLanguageProfile;
  isScorableFile: typeof isScorableFile;
  scoreFile: typeof scoreFile;
  formatAdvisory: typeof formatAdvisory;
  formatDelta: typeof formatDelta;
  signal: SignalLoggerDeps;
  stderr: (msg: string) => void;
  dedup: DedupConfig;
}

// ─── Pure Logic ──────────────────────────────────────────────────────────────

const TEST_FILE_PATTERN =
  /(?:\.(test|spec)\.(ts|tsx|js|jsx)$|Test\.php$|_test\.go$|test_.*\.py$|_spec\.rb$)/;
const TEST_SUPPRESSED_CHECKS = new Set([
  "type-import-ratio",
  "options-object-width",
  "function-count",
  "mixed-io-patterns",
  "section-headers",
]);

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
  stderr: defaultStderr,
  dedup: {
    halfLifeEdits: 5,
    halfLifeMs: 300_000,
    countCrossSessionViolations,
  },
};

export const CodeQualityGuard: SyncHookContract<ToolHookInput, CodeQualityGuardDeps> = {
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
  ): Result<SyncHookJSONOutput, ResultError> {
    const filePath = getFilePath(input)!;

    // Read the file content after the edit
    const contentResult = deps.readFile(filePath);
    if (!contentResult.ok) {
      deps.stderr(`[CodeQualityGuard] Could not read ${filePath}, skipping`);
      return ok({ continue: true });
    }

    const profile = deps.getLanguageProfile(filePath);
    if (!profile) {
      return ok({ continue: true });
    }

    // For Svelte files, only score the <script lang="ts"> block
    let contentToScore = contentResult.value;
    if (isSvelteFile(filePath)) {
      const scriptContent = extractSvelteScript(contentToScore);
      if (!scriptContent) {
        return ok({ continue: true });
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

    // Dedup: suppress identical violation reports for same file within session,
    // but resurface after half-life (edit count or elapsed time threshold).
    const hash = violationHash(result.violations);
    const prevEntry = reportedViolations.get(filePath);
    if (prevEntry && prevEntry.hash === hash && !deltaMessage) {
      const elapsed = Date.now() - prevEntry.timestamp;
      const nextEditCount = prevEntry.editCount + 1;
      const halfLifeExpired =
        nextEditCount >= deps.dedup.halfLifeEdits || elapsed >= deps.dedup.halfLifeMs;

      if (!halfLifeExpired) {
        // Same violations, no delta, within half-life — suppress and log
        reportedViolations.set(filePath, {
          hash,
          timestamp: prevEntry.timestamp,
          editCount: nextEditCount,
        });
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
        return ok({ continue: true });
      }
      // Half-life expired — resurface; reset the cache entry
    }
    reportedViolations.set(filePath, { hash, timestamp: Date.now(), editCount: 0 });

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
      return ok({ continue: true });
    }

    // Cross-session escalation: prepend REPEAT OFFENDER if 3+ prior sessions flagged this file
    const crossSessionCount = hasViolations
      ? deps.dedup.countCrossSessionViolations(deps.signal.baseDir, filePath, input.session_id)
      : 0;
    const repeatOffender = crossSessionCount >= 3;

    const parts: string[] = [];
    if (repeatOffender)
      parts.push(
        `⚠ REPEAT OFFENDER: ${filePath} has been flagged in ${crossSessionCount} prior sessions.`,
      );
    if (deltaMessage) parts.push(deltaMessage);
    if (advisory) parts.push(advisory);

    return ok({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: parts.join("\n"),
      },
    });
  },

  defaultDeps,
};
