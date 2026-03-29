/**
 * RebaseGuard Contract — Block git rebase attempts with retry-to-confirm.
 *
 * PreToolUse hook that fires on Bash commands. Detects `git rebase`,
 * `git pull --rebase`, and `git pull -r` commands.
 *
 * First attempt: blocks with a warning and records the command.
 * Second attempt (same command, same session): allows it through.
 *
 * Rebase rewrites commit history, making the local branch incompatible
 * with the remote and requiring force-push. Prefer `git merge` instead.
 *
 * Pattern: hooks/GitSafety/ProtectedBranchGuard/ProtectedBranchGuard.contract.ts
 */

import { ensureDir, readFile, removeFile, writeFile } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  type BlockOutput,
  block,
  type ContinueOutput,
  continueOk,
} from "@hooks/core/types/hook-outputs";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RebaseGuardDeps {
  stderr: (msg: string) => void;
  readState: (sessionId: string) => string | null;
  writeState: (sessionId: string, command: string) => void;
  clearState: (sessionId: string) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Matches `git rebase` at the start of a command segment (not inside arguments). */
const GIT_REBASE_PATTERN = /^\s*git\s+rebase\b/;

/**
 * Matches `git pull` at the start of a command segment.
 * Combined with flag checks for --rebase, --rebase=*, -r.
 * Excludes: --no-rebase (handled in the check function).
 */
const GIT_PULL_REBASE_PATTERN = /^\s*git\s+pull\b/;
const REBASE_FLAG_PATTERN = /(?:^|\s)(?:--rebase(?:=\S+)?|-r)(?:\s|$)/;
const NO_REBASE_FLAG_PATTERN = /--no-rebase/;

const STATE_DIR = "/tmp/pai-rebase-guard";

// ─── Pure Functions ─────────────────────────────────────────────────────────

/** Extract the command string from tool input. */
function getCommand(input: ToolHookInput): string {
  if (typeof input.tool_input === "string") return input.tool_input;
  return (input.tool_input?.command as string) || "";
}

/**
 * Extract individual command segments from a chained command.
 * Splits on &&, ||, ;, | and trims each segment.
 * Stops at heredoc markers (<<) to avoid matching inside heredoc bodies.
 */
function extractCommandSegments(command: string): string[] {
  // Truncate at heredoc marker to avoid matching inside heredoc bodies
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

function statePath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${STATE_DIR}/${safe}`;
}

function formatBlockMessage(command: string): string {
  return [
    "REBASE BLOCKED: Rebase operations rewrite history and require force-push.",
    "",
    `Command: ${command.slice(0, 200)}`,
    "",
    "Prefer git merge instead:",
    "  git merge origin/main",
    "  git pull --no-rebase origin main",
    "",
    "If you really need to rebase, retry the same command and it will be allowed.",
  ].join("\n");
}

// ─── Default Deps ───────────────────────────────────────────────────────────

const defaultDeps: RebaseGuardDeps = {
  stderr: (msg) => process.stderr.write(`${msg}\n`),

  readState: (sessionId: string): string | null => {
    const result = readFile(statePath(sessionId));
    if (!result.ok) return null;
    return result.value.trim() || null;
  },

  writeState: (sessionId: string, command: string): void => {
    ensureDir(STATE_DIR);
    writeFile(statePath(sessionId), command);
  },

  clearState: (sessionId: string): void => {
    removeFile(statePath(sessionId));
  },
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

    const sessionId = input.session_id || "unknown";

    // Check if this exact command was previously blocked in this session
    const previouslyBlocked = deps.readState(sessionId);
    if (previouslyBlocked === command) {
      deps.clearState(sessionId);
      deps.stderr(`[RebaseGuard] ALLOW: retry confirmed for — ${command.slice(0, 100)}`);
      return ok(continueOk());
    }

    // First attempt: block and record
    deps.writeState(sessionId, command);
    deps.stderr(`[RebaseGuard] BLOCK: rebase attempt detected — ${command.slice(0, 100)}`);
    return ok(block(formatBlockMessage(command)));
  },

  defaultDeps,
};
