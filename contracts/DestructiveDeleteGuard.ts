/**
 * DestructiveDeleteGuard Contract — Block recursive force-delete patterns.
 *
 * PreToolUse hook that fires on Bash, Edit, and Write tools.
 * - Bash: Detects `rm -rf` (all flag variations) and ASKs for confirmation.
 * - Edit/Write: Detects code containing `rm -rf` patterns (string literals,
 *   spawn arrays, template literals) and BLOCKs with adapter guidance.
 *
 * Does NOT block:
 * - Single-file rm (no recursive flag)
 * - Adapter functions like removeDir() (the safe alternative)
 * - rmSync in adapter code (separate concern for CodingStandardsEnforcer)
 * - Markdown files (.md, .mdx) — documentation mentioning delete patterns is normal
 */

import type { HookContract } from "@hooks/core/contract";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput, BlockOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DestructiveDeleteGuardDeps {
  stderr: (msg: string) => void;
}

// ─── Pure Functions ──────────────────────────────────────────────────────────

/**
 * Detect `rm` with both recursive and force flags in any order/combination.
 * Matches: rm -rf, rm -fr, rm -r -f, rm -f -r, rm --recursive --force, etc.
 * Does NOT match: grep -rf, rm -f (no recursive), rm file.txt (no flags).
 */
function detectsRecursiveForceDelete(command: string): boolean {
  // Match `rm` as a standalone command (word boundary), not part of other words like `grep`
  // Look for rm followed by flags that include both -r and -f in some form
  const rmSegments = command.match(/\brm\b[^|&;]*/g);
  if (!rmSegments) return false;

  for (const segment of rmSegments) {
    // Combined short flags: -rf, -fr, -rfi, -fri, etc.
    if (/\brm\b.*-[a-z]*r[a-z]*f[a-z]*\b/.test(segment)) return true;
    if (/\brm\b.*-[a-z]*f[a-z]*r[a-z]*\b/.test(segment)) return true;

    // Split short flags: -r ... -f or -f ... -r
    if (/\brm\b.*-[a-z]*r\b.*-[a-z]*f\b/.test(segment)) return true;
    if (/\brm\b.*-[a-z]*f\b.*-[a-z]*r\b/.test(segment)) return true;

    // Long flags: --recursive ... --force or --force ... --recursive
    if (/\brm\b.*--recursive\b.*--force\b/.test(segment)) return true;
    if (/\brm\b.*--force\b.*--recursive\b/.test(segment)) return true;
  }

  return false;
}

/**
 * Detect rm -rf patterns in code content (Edit new_string or Write content).
 * Catches string literals, spawn arrays, and template literals containing
 * recursive force-delete commands.
 */
function detectsRmRfInCode(content: string): boolean {
  // Spawn array patterns are always code, never false positives
  if (/["']rm["']\s*,\s*["']-rf["']/.test(content)) return true;
  if (/["']rm["']\s*,\s*["']-fr["']/.test(content)) return true;
  if (/["']rm["']\s*,\s*["']-r["']\s*,\s*["']-f["']/.test(content)) return true;
  if (/["']rm["']\s*,\s*["']-f["']\s*,\s*["']-r["']/.test(content)) return true;

  // For bare command patterns, check line-by-line skipping documentation
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    // Skip comments, markdown headers, markdown tables, doc lines
    if (/^(\/\/|\/\*|\*|#[^!]|\||--)/.test(trimmed)) continue;
    // Skip lines where the pattern is inside parentheses after text (documentation refs)
    if (/\w+\s+\(rm\s+-rf\)/.test(trimmed)) continue;

    if (/rm\s+-rf\b/.test(line)) return true;
    if (/rm\s+-fr\b/.test(line)) return true;
    if (/rm\s+-r\s+-f\b/.test(line)) return true;
    if (/rm\s+-f\s+-r\b/.test(line)) return true;
    if (/rm\s+--recursive\s+--force\b/.test(line)) return true;
    if (/rm\s+--force\s+--recursive\b/.test(line)) return true;
  }

  return false;
}

/** Check if the target file is a markdown/documentation file. */
function isDocumentationFile(input: ToolHookInput): boolean {
  const filePath = (input.tool_input?.file_path as string) || "";
  return /\.mdx?$/.test(filePath);
}

/** Extract content to check from Edit or Write tool input. */
function getContentToCheck(input: ToolHookInput): string {
  if (input.tool_name === "Write") {
    return (input.tool_input?.content as string) || "";
  }
  if (input.tool_name === "Edit") {
    return (input.tool_input?.new_string as string) || "";
  }
  return "";
}

/** Extract bash command from tool input. */
function getCommand(input: ToolHookInput): string {
  if (typeof input.tool_input === "string") return input.tool_input;
  return (input.tool_input?.command as string) || "";
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: DestructiveDeleteGuardDeps = {
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const DestructiveDeleteGuard: HookContract<
  ToolHookInput,
  ContinueOutput | BlockOutput,
  DestructiveDeleteGuardDeps
> = {
  name: "DestructiveDeleteGuard",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    return ["Bash", "Edit", "Write"].includes(input.tool_name);
  },

  execute(
    input: ToolHookInput,
    deps: DestructiveDeleteGuardDeps,
  ): Result<ContinueOutput | BlockOutput, PaiError> {
    // Bash: detect rm with recursive+force flags, BLOCK
    if (input.tool_name === "Bash") {
      const command = getCommand(input);
      if (!command) return ok({ type: "continue", continue: true });

      if (detectsRecursiveForceDelete(command)) {
        const reason = [
          "Recursive force-delete detected in Bash command.",
          "",
          `Command: ${command.slice(0, 200)}`,
          "",
          "Use removeDir() adapter for directory cleanup,",
          "or run the command manually outside Claude Code.",
        ].join("\n");

        deps.stderr(`[DestructiveDeleteGuard] BLOCK: recursive force-delete in bash command`);

        return ok({
          type: "block",
          decision: "block",
          reason,
        });
      }

      return ok({ type: "continue", continue: true });
    }

    // Edit/Write: skip markdown files — documentation mentioning delete patterns is normal
    if (isDocumentationFile(input)) {
      return ok({ type: "continue", continue: true });
    }

    // Edit/Write: detect rm -rf patterns in code, BLOCK with guidance
    const content = getContentToCheck(input);
    if (!content) return ok({ type: "continue", continue: true });

    if (detectsRmRfInCode(content)) {
      const reason = [
        "Code contains a recursive force-delete pattern (rm -rf or equivalent).",
        "",
        "Instead of embedding raw rm -rf in code, use a safe adapter function:",
        "  - removeDir(path) — wraps rmSync with proper error handling",
        "  - unlinkFile(path) — for single file deletion",
        "",
        "Raw rm -rf in code is dangerous: paths can be misconfigured,",
        "variables can be empty, and there is no safety net.",
      ].join("\n");

      deps.stderr(`[DestructiveDeleteGuard] BLOCK: rm -rf pattern in ${input.tool_name} content`);

      return ok({
        type: "block",
        decision: "block",
        reason,
      });
    }

    return ok({ type: "continue", continue: true });
  },

  defaultDeps,
};
