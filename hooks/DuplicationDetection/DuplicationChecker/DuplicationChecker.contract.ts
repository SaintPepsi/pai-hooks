/**
 * DuplicationChecker Contract — PreToolUse tiered response for Write/Edit on .ts files.
 *
 * Signal thresholds (4 dimensions: hash, name, sig, body):
 *   - 1/4: ignore
 *   - 2/4 or 3/4: log to file only
 *   - 4/4: block
 *
 * Thin contract shell. Logic lives in:
 *   - shared.ts: index loading, checking, formatting, tool input helpers
 *   - parser.ts: SWC function extraction
 */

import {
  appendFile as adapterAppendFile,
  ensureDir as adapterEnsureDir,
  readFile as adapterReadFile,
  fileExists,
} from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { BlockOutput, ContinueOutput } from "@hooks/core/types/hook-outputs";
import { continueOk } from "@hooks/core/types/hook-outputs";
import { extractFunctions } from "@hooks/hooks/DuplicationDetection/parser";
import {
  BLOCK_THRESHOLD,
  checkFunctions,
  findIndexPath,
  getArtifactsDir,
  getCurrentBranch,
  loadIndex,
  type PatternEntry,
  simulateEdit,
} from "@hooks/hooks/DuplicationDetection/shared";
import { readHookConfig } from "@hooks/lib/hook-config";
import { pickNarrative } from "@hooks/lib/narrative-reader";
import { defaultStderr } from "@hooks/lib/paths";
import { getFilePath, getWriteContent } from "@hooks/lib/tool-input";

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
  patternThreshold: number;
  requireSigMatch: boolean;
  sigMatchPercent: number;
}

// ─── Config ─────────────────────────────────────────────────────────────────

interface DuplicationCheckerConfig {
  blocking?: boolean;
  patternThreshold?: number;
  requireSigMatch?: boolean;
  sigMatchPercent?: number;
}

function readConfig(): DuplicationCheckerConfig {
  return readHookConfig<DuplicationCheckerConfig>("duplicationChecker") ?? {};
}

function readBlockingConfig(): boolean {
  return readConfig().blocking !== false;
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
  patternThreshold: readConfig().patternThreshold ?? 5,
  requireSigMatch: readConfig().requireSigMatch ?? true,
  sigMatchPercent: readConfig().sigMatchPercent ?? 60,
};

export const DuplicationCheckerContract: SyncHookContract<
  ToolHookInput,
  ContinueOutput | BlockOutput,
  DuplicationCheckerDeps
> = {
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

  execute(
    input: ToolHookInput,
    deps: DuplicationCheckerDeps,
  ): Result<ContinueOutput | BlockOutput, ResultError> {
    const filePath = getFilePath(input)!;

    const indexPath = findIndexPath(filePath, deps);
    if (!indexPath) {
      deps.stderr("[DuplicationChecker] No index found — skipping");
      return ok(continueOk());
    }

    const index = loadIndex(indexPath, deps);
    if (!index) {
      deps.stderr("[DuplicationChecker] Failed to load index — skipping");
      return ok(continueOk());
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

    if (!content) return ok(continueOk());

    const allFunctions = extractFunctions(content, filePath.endsWith(".tsx"));
    // For edits, exclude functions whose body was already present before the edit
    const functions = preEditHashes
      ? allFunctions.filter((f) => !preEditHashes!.has(f.bodyHash))
      : allFunctions;
    if (functions.length === 0) return ok(continueOk());

    // ─── Pattern advisory ───────────────────────────────────────────────
    const patternAdvisories: string[] = [];
    if (index.patterns && index.patterns.length > 0) {
      const patternMap = new Map<string, PatternEntry>(index.patterns.map((p) => [p.name, p]));
      for (const fn of functions) {
        const pattern = patternMap.get(fn.name);
        if (!pattern) continue;
        const examples = pattern.files.slice(0, 3).join(", ");
        patternAdvisories.push(
          `Pattern detected: "${pattern.name}" (${pattern.fileCount} instances across ${pattern.fileCount} files)\n` +
            `  This function matches a recurring pattern. Consider extracting a shared factory.\n` +
            `  Examples: ${examples}`,
        );
      }
    }

    function continueWithPatterns(extra?: string): ContinueOutput {
      const parts = [...patternAdvisories];
      if (extra) parts.push(extra);
      if (parts.length === 0) return continueOk();
      return { ...continueOk(), additionalContext: parts.join("\n\n") };
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
        ...blockMatches.map(
          (m) =>
            `  ${m.functionName} duplicates ${m.targetFile}:${m.targetName} (line ${m.targetLine})`,
        ),
        "",
        "Reuse the existing function instead of duplicating it.",
      ].join("\n");

      if (deps.blocking) {
        deps.stderr(
          `[DuplicationChecker] ${filePath}: BLOCKED — ${blockMatches.length} exact duplicate(s)`,
        );
        return ok({ type: "block", decision: "block", reason });
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
