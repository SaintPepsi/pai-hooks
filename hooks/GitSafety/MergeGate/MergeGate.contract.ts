/**
 * MergeGate Contract — Block gh pr merge when CI is failing or no approved review.
 *
 * PreToolUse hook that fires on Bash commands. Detects `gh pr merge`,
 * checks CI status and review status via gh CLI, and blocks when
 * conditions aren't met. Fails open on gh CLI errors.
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
import {
  checkCiStatus,
  checkReviewStatus,
  extractPrNumber,
  resolvePrFromBranch,
  type SharedDeps,
} from "@hooks/hooks/GitSafety/shared";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MergeGateDeps extends SharedDeps {}

// ─── Constants ───────────────────────────────────────────────────────────────

const MERGE_PATTERN = /\bgh\s+pr\s+merge\b/;

// ─── Pure Functions ──────────────────────────────────────────────────────────

function formatCiBlockMessage(
  prNumber: number,
  checks: Array<{ name: string; state: string }>,
): string {
  const checkLines = checks.map((c) => `  ${c.name}: ${c.state}`).join("\n");
  return [
    `MERGE BLOCKED: CI checks are not passing on PR #${prNumber}.`,
    "",
    "Failing checks:",
    checkLines,
    "",
    `Wait for CI to pass before merging. Run \`gh pr checks ${prNumber}\` to see current status.`,
  ].join("\n");
}

function formatReviewBlockMessage(
  prNumber: number,
  reviews: Array<{ author: string; state: string }>,
): string {
  const reviewLines =
    reviews.length > 0 ? reviews.map((r) => `  ${r.author}: ${r.state}`).join("\n") : "  (none)";
  return [
    `MERGE BLOCKED: No approving review found on PR #${prNumber}.`,
    "",
    "Current reviews:",
    reviewLines,
    "",
    `A reviewer must explicitly approve via \`gh pr review ${prNumber} --approve\`.`,
    "COMMENTED reviews do not count as approval.",
  ].join("\n");
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: MergeGateDeps = {
  exec: (cmd: string) => execSyncSafe(cmd, { timeout: 15_000 }),
  stderr: (msg) => process.stderr.write(`${msg}\n`),
};

// ─── Contract ────────────────────────────────────────────────────────────────

export const MergeGate: SyncHookContract<
  ToolHookInput,
  ContinueOutput | BlockOutput,
  MergeGateDeps
> = {
  name: "MergeGate",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "Bash";
  },

  execute(
    input: ToolHookInput,
    deps: MergeGateDeps,
  ): Result<ContinueOutput | BlockOutput, PaiError> {
    const command = getCommand(input);

    // Only intercept gh pr merge commands
    if (!MERGE_PATTERN.test(command)) {
      return ok(continueOk());
    }

    // Extract PR number from command or resolve from current branch
    const prNumber = extractPrNumber(command) ?? resolvePrFromBranch(deps);
    if (prNumber === null) {
      deps.stderr("[MergeGate] WARNING: Could not determine PR number. Allowing merge.");
      return ok(continueOk());
    }

    // Check CI status
    const ciStatus = checkCiStatus(prNumber, deps);
    if (ciStatus === null) {
      deps.stderr("[MergeGate] WARNING: Could not check CI status. Allowing merge.");
      return ok(continueOk());
    }

    // Check review status
    const reviewStatus = checkReviewStatus(prNumber, deps);
    if (reviewStatus === null) {
      deps.stderr("[MergeGate] WARNING: Could not check review status. Allowing merge.");
      return ok(continueOk());
    }

    // Block on CI failure or pending
    const ciFailing = ciStatus.failing.length > 0 || ciStatus.pending.length > 0;
    const noApproval = !reviewStatus.hasApproval;

    if (ciFailing && noApproval) {
      // Both issues — lead with CI, mention review
      const allBadChecks = [...ciStatus.failing, ...ciStatus.pending];
      const ciMsg = formatCiBlockMessage(prNumber, allBadChecks);
      const reviewMsg = formatReviewBlockMessage(prNumber, reviewStatus.all);
      deps.stderr(`[MergeGate] BLOCK: CI failing and no approved review on PR #${prNumber}`);
      return ok(block(`${ciMsg}\n\n${reviewMsg}`));
    }

    if (ciFailing) {
      const allBadChecks = [...ciStatus.failing, ...ciStatus.pending];
      deps.stderr(`[MergeGate] BLOCK: CI not passing on PR #${prNumber}`);
      return ok(block(formatCiBlockMessage(prNumber, allBadChecks)));
    }

    if (noApproval) {
      deps.stderr(`[MergeGate] BLOCK: No approved review on PR #${prNumber}`);
      return ok(block(formatReviewBlockMessage(prNumber, reviewStatus.all)));
    }

    // All checks passed
    return ok(continueOk());
  },

  defaultDeps,
};
