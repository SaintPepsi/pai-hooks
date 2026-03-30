/**
 * ApprovalGate Contract — Block gh pr review --approve when CI is failing.
 *
 * PreToolUse hook that fires on Bash commands. Detects `gh pr review --approve`,
 * checks CI status via gh CLI, blocks on failure, warns on pending,
 * and injects a verification reminder when CI passes. Fails open on gh CLI errors.
 *
 * Pattern: hooks/GitSafety/ProtectedBranchGuard/ProtectedBranchGuard.contract.ts
 */

import { execSyncSafe } from "@hooks/core/adapters/process";
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
import {
  checkCiStatus,
  extractPrNumber,
  resolvePrFromBranch,
  type SharedDeps,
} from "@hooks/hooks/GitSafety/shared";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ApprovalGateDeps extends SharedDeps {}

// ─── Constants ───────────────────────────────────────────────────────────────

const APPROVE_PATTERN = /\bgh\s+pr\s+review\b.*--approve/;

// ─── Pure Functions ──────────────────────────────────────────────────────────

function formatCiBlockMessage(
  prNumber: number,
  checks: Array<{ name: string; state: string }>,
): string {
  const checkLines = checks.map((c) => `  ${c.name}: ${c.state}`).join("\n");
  return [
    `APPROVAL BLOCKED: CI checks are failing on PR #${prNumber}.`,
    "",
    "Failing checks:",
    checkLines,
    "",
    "You cannot approve a PR with failing CI. Fix the issues first.",
  ].join("\n");
}

function formatPendingWarning(prNumber: number): string {
  return `CI checks are still running on PR #${prNumber}. Consider waiting for CI to complete before approving.`;
}

function formatVerificationReminder(prNumber: number): string {
  return [
    `Before approving PR #${prNumber}, confirm:`,
    "- You ran `bun test` and `tsc --noEmit` locally",
    "- You verified each acceptance criterion with evidence",
    "- You spawned a delegated reviewer agent (not a quick diff read)",
  ].join("\n");
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: ApprovalGateDeps = {
  exec: (cmd: string) => execSyncSafe(cmd, { timeout: 15_000 }),
  stderr: defaultStderr,
};

// ─── Contract ────────────────────────────────────────────────────────────────

export const ApprovalGate: SyncHookContract<
  ToolHookInput,
  ContinueOutput | BlockOutput,
  ApprovalGateDeps
> = {
  name: "ApprovalGate",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "Bash";
  },

  execute(
    input: ToolHookInput,
    deps: ApprovalGateDeps,
  ): Result<ContinueOutput | BlockOutput, PaiError> {
    const command = getCommand(input);

    // Only intercept gh pr review --approve commands
    if (!APPROVE_PATTERN.test(command)) {
      return ok(continueOk());
    }

    // Extract PR number from command or resolve from current branch
    const prNumber = extractPrNumber(command) ?? resolvePrFromBranch(deps);
    if (prNumber === null) {
      deps.stderr("[ApprovalGate] WARNING: Could not determine PR number. Allowing approval.");
      return ok(continueOk());
    }

    // Check CI status
    const ciStatus = checkCiStatus(prNumber, deps);
    if (ciStatus === null) {
      deps.stderr("[ApprovalGate] WARNING: Could not check CI status. Allowing approval.");
      return ok(continueOk());
    }

    // Block on CI failure
    if (ciStatus.failing.length > 0) {
      deps.stderr(`[ApprovalGate] BLOCK: CI failing on PR #${prNumber}`);
      return ok(block(formatCiBlockMessage(prNumber, ciStatus.failing)));
    }

    // Warn on CI pending
    if (ciStatus.pending.length > 0) {
      deps.stderr(`[ApprovalGate] WARN: CI pending on PR #${prNumber}`);
      return ok(continueOk(formatPendingWarning(prNumber)));
    }

    // CI passing — inject verification reminder
    return ok(continueOk(formatVerificationReminder(prNumber)));
  },

  defaultDeps,
};
