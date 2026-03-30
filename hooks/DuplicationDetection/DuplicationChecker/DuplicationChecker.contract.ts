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
  readJson,
} from "@hooks/core/adapters/fs";
import { getSettingsPath } from "@hooks/lib/paths";
import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { BlockOutput, ContinueOutput } from "@hooks/core/types/hook-outputs";
import { extractFunctions } from "@hooks/hooks/DuplicationDetection/parser";
import { pickNarrative } from "@hooks/lib/narrative-reader";
import { getFilePath, getWriteContent } from "@hooks/lib/tool-input";
import {
  BLOCK_THRESHOLD,
  checkFunctions,
  findIndexPath,
  getArtifactsDir,
  getCurrentBranch,
  loadIndex,
  simulateEdit,
} from "@hooks/hooks/DuplicationDetection/shared";

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
}

// ─── Config ─────────────────────────────────────────────────────────────────

function readBlockingConfig(): boolean {
  const settingsResult = readJson(getSettingsPath());
  if (!settingsResult.ok) return true;
  const settings = settingsResult.value as Record<string, unknown>;
  const hookConfig = settings.hookConfig as Record<string, unknown> | undefined;
  if (!hookConfig) return true;
  const dcConfig = hookConfig.duplicationChecker as Record<string, unknown> | undefined;
  if (!dcConfig) return true;
  return dcConfig.blocking !== false;
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
  stderr: (msg) => process.stderr.write(`${msg}\n`),
  now: () => Date.now(),
  blocking: readBlockingConfig(),
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

  execute(input: ToolHookInput, deps: DuplicationCheckerDeps): Result<ContinueOutput | BlockOutput, PaiError> {
    const filePath = getFilePath(input)!;

    const indexPath = findIndexPath(filePath, deps);
    if (!indexPath) {
      deps.stderr("[DuplicationChecker] No index found — skipping");
      return ok({ type: "continue", continue: true });
    }

    const index = loadIndex(indexPath, deps);
    if (!index) {
      deps.stderr("[DuplicationChecker] Failed to load index — skipping");
      return ok({ type: "continue", continue: true });
    }

    // Get content: Write has it directly, Edit needs simulation
    let content: string | null = null;
    if (input.tool_name === "Write") {
      content = getWriteContent(input);
    } else {
      const currentContent = deps.readFile(filePath);
      if (currentContent) content = simulateEdit(currentContent, input);
    }

    if (!content) return ok({ type: "continue", continue: true });

    const functions = extractFunctions(content, filePath.endsWith(".tsx"));
    if (functions.length === 0) return ok({ type: "continue", continue: true });

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
    };
    deps.appendFile(logPath, `${JSON.stringify(logEntry)}\n`);

    if (matches.length === 0) {
      deps.stderr(`[DuplicationChecker] ${filePath}: clean`);
      return ok({ type: "continue", continue: true });
    }

    // Check if any match has all 4 dimensions (hash+name+sig+body) → block
    const blockMatches = matches.filter((m) => m.signals.length >= BLOCK_THRESHOLD);

    if (blockMatches.length > 0) {
      const opener = pickNarrative("DuplicationChecker", blockMatches.length, import.meta.dir);
      const reason = [
        opener,
        "",
        ...blockMatches.map(
          (m) => `  ${m.functionName} duplicates ${m.targetFile}:${m.targetName} (line ${m.targetLine})`,
        ),
        "",
        "Reuse the existing function instead of duplicating it.",
      ].join("\n");

      if (deps.blocking) {
        deps.stderr(`[DuplicationChecker] ${filePath}: BLOCKED — ${blockMatches.length} exact duplicate(s)`);
        return ok({ type: "block", decision: "block", reason });
      }

      deps.stderr(`[DuplicationChecker] ${filePath}: ${blockMatches.length} exact duplicate(s) (blocking disabled)`);
    }

    // 2-3 signals: log only, no additionalContext, no block
    deps.stderr(`[DuplicationChecker] ${filePath}: ${matches.length} finding(s) logged (below block threshold)`);
    return ok({ type: "continue", continue: true });
  },

  defaultDeps,
};
