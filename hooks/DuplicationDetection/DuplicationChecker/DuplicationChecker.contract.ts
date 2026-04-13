/**
 * DuplicationChecker Contract — PreToolUse tiered response for Write/Edit on .ts files.
 *
 * Signal thresholds (4 dimensions: hash, name, sig, body):
 *   - 1/4: ignore
 *   - 2/4 or 3/4: log to file only
 *   - 4/4: block (with optional inference triage to suppress false positives)
 *
 * Thin contract shell. Logic lives in:
 *   - shared.ts: index loading, checking, formatting, tool input helpers
 *   - parser.ts: SWC function extraction
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import {
  appendFile as adapterAppendFile,
  ensureDir as adapterEnsureDir,
  readFile as adapterReadFile,
  fileExists,
} from "@hooks/core/adapters/fs";
import type { AsyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, tryCatchAsync, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { extractFunctions } from "@hooks/hooks/DuplicationDetection/parser";
import {
  BLOCK_THRESHOLD,
  checkFunctions,
  findIndexPath,
  getArtifactsDir,
  getCurrentBranch,
  loadIndex,
  type DuplicationMatch,
  type PatternEntry,
  simulateEdit,
} from "@hooks/hooks/DuplicationDetection/shared";
import { readHookConfig } from "@hooks/lib/hook-config";
import { pickNarrative } from "@hooks/lib/narrative-reader";
import { defaultStderr } from "@hooks/lib/paths";
import { getFilePath, getWriteContent } from "@hooks/lib/tool-input";
import type { InferenceOptions, InferenceResult } from "@pai/Tools/Inference";
import { inference as stubInference } from "@pai/Tools/Inference";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DuplicationCheckerDeps {
  readFile: (path: string) => string | null;
  exists: (path: string) => boolean;
  appendFile: (path: string, content: string) => void;
  ensureDir: (path: string) => void;
  stderr: (msg: string) => void;
  now: () => number;
  /** When true, 4/4 signal matches block the operation. When false, they log only. */
  blocking: boolean;
  /** When true, inference triage runs on block-worthy matches to suppress false positives. */
  inferenceEnabled: boolean;
  /** Inference function — injected for testing. */
  inference: (opts: InferenceOptions) => Promise<InferenceResult>;
  /** When true, false-positive reports are written to /tmp/pai/duplication/fp-reports/. */
  issueReporting: boolean;
}

// ─── Config ─────────────────────────────────────────────────────────────────

function readBlockingConfig(): boolean {
  const cfg = readHookConfig<{ blocking?: boolean }>("duplicationChecker");
  return cfg?.blocking !== false;
}

function readInferenceConfig(): boolean {
  const cfg = readHookConfig<{ inferenceEnabled?: boolean }>("duplicationChecker");
  return cfg?.inferenceEnabled === true;
}

// ─── Inference Triage ────────────────────────────────────────────────────────

type TriageVerdict = "true_positive" | "false_positive" | "uncertain";

async function classifyMatches(
  blockMatches: DuplicationMatch[],
  content: string,
  filePath: string,
  deps: DuplicationCheckerDeps,
): Promise<TriageVerdict> {
  const matchDescriptions = blockMatches
    .map(
      (m) =>
        `Function "${m.functionName}" in ${filePath} duplicates "${m.targetName}" in ${m.targetFile} (line ${m.targetLine}, signals: ${m.signals.join(", ")})`,
    )
    .join("\n");

  const prompt = [
    "You are a code duplication triage assistant.",
    "Determine if the following duplication detection result is a true positive (real duplicate that should be refactored) or a false positive (legitimate code that appears similar but serves a distinct purpose).",
    "",
    "Duplication findings:",
    matchDescriptions,
    "",
    "File being written:",
    "```typescript",
    content.slice(0, 2000),
    "```",
    "",
    'Respond with JSON only: { "verdict": "true_positive" | "false_positive" | "uncertain", "reason": "brief explanation" }',
  ].join("\n");

  const result = await tryCatchAsync(
    () => deps.inference({ prompt, level: "fast", timeout: 4000 }),
    () => null,
  );

  if (!result.ok || !result.value || !result.value.success || !result.value.output) {
    return "uncertain";
  }

  const parseResult = tryCatchAsync(
    async () => {
      const raw = result.value!.parsed ?? JSON.parse(result.value!.output);
      return (raw as { verdict?: string }).verdict;
    },
    () => null,
  );

  const parsed = await parseResult;
  if (!parsed.ok || parsed.value === null) return "uncertain";

  const verdict = parsed.value;
  if (verdict === "true_positive" || verdict === "false_positive" || verdict === "uncertain") {
    return verdict;
  }
  return "uncertain";
}

// ─── False Positive Reporting ────────────────────────────────────────────────

function createFalsePositiveReport(
  blockMatches: DuplicationMatch[],
  filePath: string,
  deps: DuplicationCheckerDeps,
): void {
  if (!deps.issueReporting) return;

  const hash = blockMatches.map((m) => `${m.functionName}:${m.targetFile}`).join("|");
  const reportDir = "/tmp/pai/duplication/fp-reports";
  const safeHash = hash.slice(0, 32).replace(/[^a-zA-Z0-9]/g, "_");
  const lockPath = `${reportDir}/${safeHash}.lock`;

  deps.ensureDir(reportDir);

  if (deps.exists(lockPath)) {
    const content = deps.readFile(lockPath);
    if (content) {
      const ts = parseInt(content.trim(), 10);
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (!isNaN(ts) && deps.now() - ts < sevenDays) return;
    }
  }

  deps.appendFile(lockPath, String(deps.now()));

  const report = {
    ts: new Date(deps.now()).toISOString(),
    file: filePath,
    matches: blockMatches.map((m) => ({
      fn: m.functionName,
      target: `${m.targetFile}:${m.targetName}`,
      signals: m.signals,
    })),
  };
  deps.appendFile(`${reportDir}/${safeHash}.report.json`, JSON.stringify(report, null, 2));
}

// ─── Contract ───────────────────────────────────────────────────────────────

const defaultDeps: DuplicationCheckerDeps = {
  readFile: (path: string): string | null => {
    const result = adapterReadFile(path);
    return result.ok ? result.value : null;
  },
  exists: (path: string): boolean => fileExists(path),
  appendFile: (path: string, content: string): void => {
    adapterAppendFile(path, content);
  },
  ensureDir: (path: string): void => {
    adapterEnsureDir(path);
  },
  stderr: defaultStderr,
  now: () => Date.now(),
  blocking: readBlockingConfig(),
  inferenceEnabled: readInferenceConfig(),
  inference: stubInference,
  issueReporting: false,
};

export const DuplicationCheckerContract: AsyncHookContract<ToolHookInput, DuplicationCheckerDeps> = {
  name: "DuplicationChecker",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    if (input.tool_name !== "Write" && input.tool_name !== "Edit") return false;
    const filePath = getFilePath(input);
    if (!filePath) return false;
    if (!filePath.endsWith(".ts")) return false;
    if (filePath.endsWith(".d.ts")) return false;
    return true;
  },

  async execute(
    input: ToolHookInput,
    deps: DuplicationCheckerDeps,
  ): Promise<Result<SyncHookJSONOutput, ResultError>> {
    const filePath = getFilePath(input)!;

    const indexPath = findIndexPath(filePath, deps);
    if (!indexPath) {
      deps.stderr("[DuplicationChecker] No index found — skipping");
      return ok({ continue: true });
    }

    const index = loadIndex(indexPath, deps);
    if (!index) {
      deps.stderr("[DuplicationChecker] Failed to load index — skipping");
      return ok({ continue: true });
    }

    // Get content: Write has it directly, Edit needs simulation
    let content: string | null = null;
    let preEditHashes: Set<string> | null = null;
    if (input.tool_name === "Write") {
      content = getWriteContent(input);
    } else {
      const currentContent = deps.readFile(filePath);
      if (currentContent) {
        content = simulateEdit(currentContent, input);
        // Build set of body hashes present before this edit so we only flag new/changed functions
        const preFunctions = extractFunctions(currentContent, filePath.endsWith(".tsx"));
        preEditHashes = new Set(preFunctions.map((f) => f.bodyHash));
      }
    }

    if (!content) return ok({ continue: true });

    const allFunctions = extractFunctions(content, filePath.endsWith(".tsx"));
    // For edits, exclude functions whose body was already present before the edit
    const functions = preEditHashes
      ? allFunctions.filter((f) => !preEditHashes!.has(f.bodyHash))
      : allFunctions;
    if (functions.length === 0) return ok({ continue: true });

    // ─── Pattern advisory ───────────────────────────────────────────────
    const patternAdvisories: string[] = [];
    if (index.patterns && index.patterns.length > 0) {
      const patternMap = new Map<string, PatternEntry>(index.patterns.map((p) => [p.name, p]));
      for (const fn of functions) {
        const pattern = patternMap.get(fn.name);
        if (!pattern) continue;
        const examples = pattern.files.slice(0, 3).join(", ");
        patternAdvisories.push(
          `Pattern detected: "${pattern.name}" (${pattern.fileCount} files)\n` +
            `  This function matches a recurring pattern. Consider extracting a shared factory.\n` +
            `  Examples: ${examples}`,
        );
      }
    }

    function continueWithPatterns(extra?: string): SyncHookJSONOutput {
      const parts = [...patternAdvisories];
      if (extra) parts.push(extra);
      if (parts.length === 0) return { continue: true };
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: parts.join("\n\n"),
        },
      };
    }

    const relPath = filePath.startsWith(index.root)
      ? filePath.slice(index.root.length + 1)
      : filePath;

    const matches = checkFunctions(functions, index, relPath);

    // Log all checks (findings or clean) to /tmp/pai/duplication/{hash}/{branch}/checker.jsonl
    const branch = getCurrentBranch(index.root) ?? "default";
    const logDir = getArtifactsDir(index.root, branch);
    deps.ensureDir(logDir);
    const logPath = `${logDir}/checker.jsonl`;
    const logEntry = {
      ts: new Date(deps.now()).toISOString(),
      branch,
      file: relPath,
      functions: functions.length,
      matches: matches.map((m) => ({
        fn: m.functionName,
        target: `${m.targetFile}:${m.targetName}`,
        signals: m.signals,
        score: Math.round(m.topScore * 100),
      })),
      patterns:
        patternAdvisories.length > 0
          ? functions
              .filter((fn) => index.patterns?.some((p) => p.name === fn.name))
              .map((fn) => {
                const p = index.patterns!.find((pat) => pat.name === fn.name)!;
                return { fn: fn.name, patternId: p.id, instances: p.fileCount };
              })
          : undefined,
    };
    deps.appendFile(logPath, `${JSON.stringify(logEntry)}\n`);

    if (matches.length === 0) {
      deps.stderr(`[DuplicationChecker] ${filePath}: clean`);
      return ok(continueWithPatterns());
    }

    // Separate derivation matches (advisory) from real duplicates (blockable)
    const derivationMatches = matches.filter((m) => m.derivation);
    const realMatches = matches.filter((m) => !m.derivation);

    // Block on exact body hash match (identical code + same sig) OR all 4 signal dimensions
    const blockMatches = realMatches.filter(
      (m) => m.signals.includes("hash") || m.signals.length >= BLOCK_THRESHOLD,
    );

    if (blockMatches.length > 0) {
      const opener = pickNarrative("DuplicationChecker", blockMatches.length, import.meta.dir);
      const reason = [
        opener,
        "",
        ...blockMatches.flatMap((m) => {
          const guidance = m.targetIsSource
            ? `  → Import it from ${m.targetFile}`
            : `  → Reuse the existing function from ${m.targetFile} or extract both to a shared module`;
          return [
            `  ${m.functionName} duplicates ${m.targetFile}:${m.targetName} (line ${m.targetLine})`,
            guidance,
          ];
        }),
      ].join("\n");

      if (deps.blocking) {
        if (deps.inferenceEnabled) {
          const verdict = await classifyMatches(blockMatches, content, filePath, deps);
          if (verdict === "false_positive") {
            createFalsePositiveReport(blockMatches, filePath, deps);
            deps.stderr(
              `[DuplicationChecker] ${filePath}: inference triage — false positive, allowing write`,
            );
            return ok({
              continue: true,
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                additionalContext:
                  "Duplication triage: inference classified this as a false positive — write allowed. The flagged functions appear similar but serve distinct purposes.",
              },
            });
          }
          deps.stderr(
            `[DuplicationChecker] ${filePath}: inference triage — ${verdict}, blocking`,
          );
        }
        deps.stderr(
          `[DuplicationChecker] ${filePath}: BLOCKED — ${blockMatches.length} exact duplicate(s)`,
        );
        return ok({
          continue: true,
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: reason,
          },
        });
      }

      deps.stderr(
        `[DuplicationChecker] ${filePath}: ${blockMatches.length} exact duplicate(s) (blocking disabled)`,
      );
    }

    // Derivation matches: same body, different signature — advisory only, never block
    if (derivationMatches.length > 0) {
      const advisory = derivationMatches
        .map(
          (m) =>
            `  ${m.functionName} has identical body to ${m.targetFile}:${m.targetName} but different signature — possible derivation issue`,
        )
        .join("\n");
      deps.stderr(
        `[DuplicationChecker] ${filePath}: ${derivationMatches.length} derivation(s) detected`,
      );
      return ok(continueWithPatterns(advisory));
    }

    // 2-3 signals: log only, no additionalContext, no block
    deps.stderr(
      `[DuplicationChecker] ${filePath}: ${matches.length} finding(s) logged (below block threshold)`,
    );
    return ok(continueWithPatterns());
  },

  defaultDeps,
};
