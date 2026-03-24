/**
 * DestructiveDeleteGuard Contract — Block destructive delete patterns.
 *
 * PreToolUse hook that fires on Bash, Edit, and Write tools.
 * - Bash: Detects recursive/destructive delete commands and BLOCKs.
 *   Covers: rm -r, find -delete, python rmtree, perl rmtree, ruby rm_rf,
 *   node/bun rmSync, rsync --delete, git clean -d.
 * - Edit/Write: Detects code containing destructive delete patterns
 *   (string literals, spawn arrays, template literals, API calls) and BLOCKs.
 *
 * Does NOT block:
 * - Single-file rm (no recursive flag)
 * - Adapter functions like removeDir() (the safe alternative)
 * - Markdown files (.md, .mdx) — documentation mentioning patterns is normal
 * - git rm --cached (only untracks files, doesn't delete from disk)
 */

import type { SyncHookContract } from "@hooks/core/contract";
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
 * Detect destructive delete commands in a Bash command string.
 * Covers rm -r, find -delete, python rmtree, rsync --delete, git clean -d, etc.
 */
function detectsDestructiveDelete(command: string): boolean {
  // git rm --cached only untracks files, doesn't delete from disk — always safe
  if (/\bgit\s+rm\b/.test(command) && /--cached\b/.test(command)) return false;

  // rm with recursive flag (segmented to avoid matching grep -rf etc.)
  const rmSegments = command.match(/\brm\b[^|&;]*/g);
  if (rmSegments) {
    for (const segment of rmSegments) {
      // Require whitespace before the dash so file paths like device-profile.md
      // don't false-positive as recursive flags
      if (/\brm\b.*\s-[a-z]*r[a-z]*\b/.test(segment)) return true;
      if (/\brm\b.*\s--recursive\b/.test(segment)) return true;
    }
  }

  // find -delete or find -exec rm
  if (/\bfind\b.*-delete\b/.test(command)) return true;
  if (/\bfind\b.*-exec\b.*\brm\b/.test(command)) return true;

  // python/perl/ruby rmtree / rm_rf
  if (/\bpython[23]?\b.*\brmtree\b/.test(command)) return true;
  if (/\bperl\b.*\brmtree\b/.test(command)) return true;
  if (/\bruby\b.*\brm_rf\b/.test(command)) return true;

  // node/bun -e with rmSync
  if (/\b(?:node|bun)\b.*\brmSync\b/.test(command)) return true;

  // rsync --delete
  if (/\brsync\b.*--delete\b/.test(command)) return true;

  // git clean with -d flag
  if (/\bgit\s+clean\b.*-[a-z]*d/.test(command)) return true;

  return false;
}

/**
 * Detect destructive delete patterns in code content (Edit new_string or Write content).
 * Catches string literals, spawn arrays, template literals, and API calls.
 */
function detectsDestructiveDeleteInCode(content: string): boolean {
  // git rm --cached only untracks files — strip these lines before checking
  // so test files and code mentioning them pass through
  const cleaned = content.replace(/\bgit\s+rm\b[^\n]*--cached\b[^\n]*/g, "");

  // Spawn array patterns: "rm", "-r" or "rm", "-rf" etc.
  if (/["']rm["']\s*,\s*["']-[a-z]*r[a-z]*["']/.test(cleaned)) return true;

  // Python shutil.rmtree
  if (/\bshutil\.rmtree\b/.test(cleaned)) return true;

  // Generic rmtree( call (perl, etc.)
  if (/\brmtree\s*\(/.test(cleaned)) return true;

  // Ruby FileUtils.rm_rf
  if (/\bFileUtils\.rm_rf\b/.test(cleaned)) return true;

  // Node rmSync with recursive (whole-content check)
  if (/\brmSync\b/.test(cleaned) && /\brecursive\b/.test(cleaned)) return true;

  for (const line of cleaned.split("\n")) {
    const trimmed = line.trim();
    // Skip comments, markdown headers, markdown tables, doc lines
    if (/^(\/\/|\/\*|\*|#[^!]|\||--)/.test(trimmed)) continue;
    // Skip documentation references in parentheses
    if (/\w+\s+\(rm\s+-r[f]?\)/.test(trimmed)) continue;

    // rm with recursive flag
    if (/rm\s+-[a-z]*r[a-z]*\b/.test(line)) return true;
    if (/rm\s+--recursive\b/.test(line)) return true;

    // find -delete in code
    if (/find\s+.*-delete\b/.test(line)) return true;

    // rsync --delete in code
    if (/rsync\s+.*--delete\b/.test(line)) return true;

    // git clean -d in code
    if (/git\s+clean\b.*-[a-z]*d/.test(line)) return true;
  }

  return false;
}

/** Check if the target file is a markdown/documentation file. */
function isDocumentationFile(input: ToolHookInput): boolean {
  const filePath = (input.tool_input?.file_path as string) || "";
  return /\.mdx?$/.test(filePath);
}

/** Check if the target file is a Dockerfile — rm -rf in containers is image cleanup, not host deletion. */
function isDockerfile(input: ToolHookInput): boolean {
  const filePath = (input.tool_input?.file_path as string) || "";
  const basename = filePath.split("/").pop() || "";
  return /^Dockerfile(\..+)?$/.test(basename) || basename === ".dockerignore";
}

/** Check if the target file is the fs adapter — the one place raw rmSync belongs. */
function isFsAdapter(input: ToolHookInput): boolean {
  const filePath = (input.tool_input?.file_path as string) || "";
  return filePath.endsWith("core/adapters/fs.ts");
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

export const DestructiveDeleteGuard: SyncHookContract<
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
    // Bash: detect destructive delete patterns, BLOCK
    if (input.tool_name === "Bash") {
      const command = getCommand(input);
      if (!command) return ok({ type: "continue", continue: true });

      if (detectsDestructiveDelete(command)) {
        const reason = [
          "Destructive delete pattern detected in Bash command.",
          "",
          `Command: ${command.slice(0, 200)}`,
          "",
          "Use removeDir() adapter for directory cleanup,",
          "or run the command manually outside Claude Code.",
        ].join("\n");

        deps.stderr(`[DestructiveDeleteGuard] BLOCK: destructive delete in bash command`);

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

    // Edit/Write: skip Dockerfiles — rm -rf in containers is image cleanup (apt lists, caches), not host deletion
    if (isDockerfile(input)) {
      return ok({ type: "continue", continue: true });
    }

    // Edit/Write: skip the fs adapter — it is the safe wrapper, raw rmSync belongs there
    if (isFsAdapter(input)) {
      return ok({ type: "continue", continue: true });
    }

    // Edit/Write: detect destructive delete patterns in code, BLOCK with guidance
    const content = getContentToCheck(input);
    if (!content) return ok({ type: "continue", continue: true });

    if (detectsDestructiveDeleteInCode(content)) {
      const reason = [
        "Code contains a destructive delete pattern.",
        "",
        "Instead of embedding raw destructive delete in code, use a safe adapter function:",
        "  - removeDir(path) — wraps rmSync with proper error handling",
        "  - unlinkFile(path) — for single file deletion",
        "",
        "Raw destructive delete in code is dangerous: paths can be misconfigured,",
        "variables can be empty, and there is no safety net.",
      ].join("\n");

      deps.stderr(`[DestructiveDeleteGuard] BLOCK: destructive delete pattern in ${input.tool_name} content`);

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
