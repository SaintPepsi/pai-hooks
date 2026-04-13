/**
 * RebaseGuard Contract — Risk-aware rebase blocking.
 *
 * PreToolUse hook that fires on Bash commands. Detects rebase-related
 * commands and responds in three tiers:
 *
 *   allow — git rebase --abort, git rebase --continue, git pull --rebase
 *   warn  — any rebase on an unpublished branch (advisory, continues)
 *   block — interactive rebase or plain rebase on a published branch
 *
 * "Published" means the branch has a remote upstream tracking ref. If branch
 * state cannot be determined, the hook fails open (warns instead of blocks).
 *
 * Pattern: hooks/GitSafety/ProtectedBranchGuard/ProtectedBranchGuard.contract.ts
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { execSyncSafe } from "@hooks/core/adapters/process";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { defaultStderr } from "@hooks/lib/paths";
import { getCommand } from "@hooks/lib/tool-input";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RebaseGuardDeps {
  hasUpstream: () => boolean;
  stderr: (msg: string) => void;
}

/** Four-tier classification of a command with respect to rebase risk. */
export type RebaseClassification = "allow" | "warn" | "block" | null;

// ─── Constants ──────────────────────────────────────────────────────────────

/** Matches `git rebase` at the start of a command segment. */
const GIT_REBASE_PATTERN = /^\s*git\s+rebase\b/;

/** Matches `git rebase --abort` or `git rebase --continue` — safe in-progress controls. */
const REBASE_SAFE_FLAG_PATTERN = /^\s*git\s+rebase\s+(?:--abort|--continue)\b/;

/** Matches `-i` or `--interactive` flag anywhere in a git rebase command. */
const INTERACTIVE_FLAG_PATTERN = /(?:^|\s)(?:-i|--interactive)(?:\s|$)/;

/** Matches `git pull` at the start of a command segment. */
const GIT_PULL_PATTERN = /^\s*git\s+pull\b/;

/** Matches --rebase, --rebase=*, or -r flags on a pull command. */
const REBASE_FLAG_PATTERN = /(?:^|\s)(?:--rebase(?:=\S+)?|-r)(?:\s|$)/;

/** Matches --no-rebase negation flag on a pull command. */
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

/**
 * Classify the command segment's rebase risk at the command level only.
 * Returns:
 *   "allow"     — safe in-progress control (--abort/--continue) or pull --rebase
 *   "interactive" — -i/--interactive flag detected on git rebase
 *   "plain"     — git rebase without safe flags or interactive flag
 *   null        — not a rebase command
 */
function classifySegment(segment: string): "allow" | "interactive" | "plain" | null {
  // git pull --rebase variants → always allow (not history-rewriting on local branch)
  if (GIT_PULL_PATTERN.test(segment)) {
    if (NO_REBASE_FLAG_PATTERN.test(segment)) return null;
    if (REBASE_FLAG_PATTERN.test(segment)) return "allow";
    return null;
  }

  if (!GIT_REBASE_PATTERN.test(segment)) return null;

  // git rebase --abort / --continue → always allow
  if (REBASE_SAFE_FLAG_PATTERN.test(segment)) return "allow";

  // git rebase -i / --interactive
  if (INTERACTIVE_FLAG_PATTERN.test(segment)) return "interactive";

  return "plain";
}

/**
 * Classify the full command (including chained segments) into a final risk tier.
 *
 * @param command    The full bash command string.
 * @param isPublished Whether the current branch has a remote upstream tracking ref.
 * @returns The final risk tier:
 *   - null     — no rebase operation detected
 *   - "allow"  — safe operation (abort/continue or pull --rebase only)
 *   - "warn"   — rebase on unpublished branch (advisory, continues)
 *   - "block"  — rebase on published branch (history would need force-push)
 */
export function classifyRebase(command: string, isPublished: boolean): RebaseClassification {
  const segments = extractCommandSegments(command);

  let highestRisk: "allow" | "interactive" | "plain" | null = null;

  for (const segment of segments) {
    const risk = classifySegment(segment);
    if (risk === null) continue;
    if (risk === "interactive" || (risk === "plain" && highestRisk !== "interactive")) {
      highestRisk = risk;
    } else if (risk === "allow" && highestRisk === null) {
      highestRisk = "allow";
    }
  }

  if (highestRisk === null) return null;
  if (highestRisk === "allow") return "allow";

  // interactive or plain rebase
  return isPublished ? "block" : "warn";
}

function formatBlockMessage(command: string, isInteractive: boolean): string {
  const reason = isInteractive
    ? "Interactive rebase rewrites history and produces diverged branches that require force-push."
    : "Rebase rewrites commit history, making the local branch incompatible with the remote and requiring force-push.";

  return [
    "REBASE BLOCKED: Rebase on a published branch is prohibited.",
    "",
    `Command: ${command.slice(0, 200)}`,
    "",
    reason,
    "",
    "Use git merge instead:",
    "  git merge origin/main",
    "  git pull --no-rebase origin main",
  ].join("\n");
}

function formatWarnMessage(command: string): string {
  return [
    "[RebaseGuard] ADVISORY: Rebase detected on an unpublished branch.",
    "",
    `Command: ${command.slice(0, 200)}`,
    "",
    "This branch has no remote upstream — rebase is lower risk here.",
    "Once you publish this branch (git push -u origin ...), rebase will be blocked.",
    "",
    "Prefer git merge to keep history intact:",
    "  git merge origin/main",
  ].join("\n");
}

// ─── Default Deps ───────────────────────────────────────────────────────────

const defaultDeps: RebaseGuardDeps = {
  hasUpstream: () => {
    const result = execSyncSafe("git rev-parse --abbrev-ref @{upstream}");
    return result.ok && result.value.trim().length > 0;
  },
  stderr: defaultStderr,
};

// ─── Contract ───────────────────────────────────────────────────────────────

export const RebaseGuard: SyncHookContract<ToolHookInput, RebaseGuardDeps> = {
  name: "RebaseGuard",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "Bash";
  },

  execute(input: ToolHookInput, deps: RebaseGuardDeps): Result<SyncHookJSONOutput, ResultError> {
    const command = getCommand(input);

    // Determine published state — fail open (treat as unpublished) if unknown
    const isPublished = deps.hasUpstream();
    const tier = classifyRebase(command, isPublished);

    if (tier === null || tier === "allow") {
      return ok({ continue: true });
    }

    if (tier === "warn") {
      deps.stderr(`[RebaseGuard] ADVISORY: rebase on unpublished branch — ${command.slice(0, 100)}`);
      return ok({
        continue: true,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: formatWarnMessage(command),
        },
      });
    }

    // tier === "block"
    const isInteractive = INTERACTIVE_FLAG_PATTERN.test(command);
    deps.stderr(`[RebaseGuard] BLOCK: rebase on published branch — ${command.slice(0, 100)}`);
    return ok({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: formatBlockMessage(command, isInteractive),
      },
    });
  },

  defaultDeps,
};
