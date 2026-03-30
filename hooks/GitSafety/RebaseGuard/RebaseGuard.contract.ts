/**
 * RebaseGuard Contract — Unconditionally block all git rebase attempts.
 *
 * PreToolUse hook that fires on Bash commands. Detects `git rebase`,
 * `git pull --rebase`, and `git pull -r` commands and blocks them,
 * directing the user to use `git merge` instead. No exceptions.
 *
 * Rebase rewrites commit history, making the local branch incompatible
 * with the remote and requiring force-push. Always use merge instead.
 *
 * Pattern: hooks/GitSafety/ProtectedBranchGuard/ProtectedBranchGuard.contract.ts
 */

import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { getCommand } from "@hooks/lib/tool-input";
import {
  type BlockOutput,
  block,
  type ContinueOutput,
  continueOk,
} from "@hooks/core/types/hook-outputs";
import { defaultStderr } from "@hooks/lib/paths";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RebaseGuardDeps {
  stderr: (msg: string) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Matches `git rebase` at the start of a command segment. */
const GIT_REBASE_PATTERN = /^\s*git\s+rebase\b/;

/**
 * Matches `git pull` at the start of a command segment.
 * Combined with flag checks for --rebase, --rebase=*, -r.
 * Excludes: --no-rebase (handled in the check function).
 */
const GIT_PULL_REBASE_PATTERN = /^\s*git\s+pull\b/;
const REBASE_FLAG_PATTERN = /(?:^|\s)(?:--rebase(?:=\S+)?|-r)(?:\s|$)/;
const NO_REBASE_FLAG_PATTERN = /--no-rebase/;

// ─── Pure Functions ─────────────────────────────────────────────────────────

/**
 * Extract individual command segments from a chained command.
 * Splits on &&, ||, ;, | and trims each segment.
 * Stops at heredoc markers (<<) to avoid matching inside heredoc bodies.
 */
function extractCommandSegments(command: string): string[] {
  const beforeHeredoc = command.split(/<<['"]?\w/)[0] || command;
  return beforeHeredoc.split(/\s*(?:&&|\|\||[;|])\s*/).map((s) => s.trim());
}

/** Check if command is a rebase operation. */
function isRebaseCommand(command: string): boolean {
  const segments = extractCommandSegments(command);

  for (const segment of segments) {
    // Direct git rebase
    if (GIT_REBASE_PATTERN.test(segment)) return true;

    // git pull with --rebase or -r flag (but not --no-rebase)
    if (GIT_PULL_REBASE_PATTERN.test(segment)) {
      if (NO_REBASE_FLAG_PATTERN.test(segment)) continue;
      if (REBASE_FLAG_PATTERN.test(segment)) return true;
    }
  }

  return false;
}

function formatBlockMessage(command: string): string {
  return [
    "REBASE BLOCKED: All rebase operations are permanently prohibited.",
    "",
    `Command: ${command.slice(0, 200)}`,
    "",
    "Rebase rewrites commit history, making the local branch incompatible",
    "with the remote and requiring force-push. This is never allowed.",
    "",
    "Use git merge instead:",
    "  git merge origin/main",
    "  git pull --no-rebase origin main",
  ].join("\n");
}

// ─── Default Deps ───────────────────────────────────────────────────────────

const defaultDeps: RebaseGuardDeps = {
  stderr: defaultStderr,
};

// ─── Contract ───────────────────────────────────────────────────────────────

export const RebaseGuard: SyncHookContract<
  ToolHookInput,
  ContinueOutput | BlockOutput,
  RebaseGuardDeps
> = {
  name: "RebaseGuard",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "Bash";
  },

  execute(
    input: ToolHookInput,
    deps: RebaseGuardDeps,
  ): Result<ContinueOutput | BlockOutput, PaiError> {
    const command = getCommand(input);

    if (!isRebaseCommand(command)) {
      return ok(continueOk());
    }

    deps.stderr(`[RebaseGuard] BLOCK: rebase attempt detected — ${command.slice(0, 100)}`);
    return ok(block(formatBlockMessage(command)));
  },

  defaultDeps,
};
