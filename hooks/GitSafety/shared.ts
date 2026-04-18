/**
 * GitSafety Shared — PR number extraction and CI/review status checking.
 *
 * Used by MergeGate and ApprovalGate hooks. All gh CLI calls go through
 * injected deps.exec for testability. Fails open on parse errors.
 */

import type { ResultError } from "@hooks/core/error";
import { jsonParseFailed } from "@hooks/core/error";
import { type Result, tryCatch } from "@hooks/core/result";

// ─── Domain Types ────────────────────────────────────────────────────────────

export interface CiCheck {
  name: string;
  state: string;
}

export interface Review {
  author: string;
  state: string;
}

export interface CiStatus {
  failing: CiCheck[];
  pending: CiCheck[];
  allPassing: boolean;
}

export interface ReviewStatus {
  approved: Review[];
  all: Review[];
  hasApproval: boolean;
}

export interface SharedDeps {
  exec: (cmd: string) => Result<string, ResultError>;
  stderr: (msg: string) => void;
}

// ─── Command Pattern Matching ────────────────────────────────────────────────

/** Check if a command matches a pattern. */
export function matchesCommand(command: string, pattern: RegExp): boolean {
  return pattern.test(command);
}

// ─── PR Number Extraction ────────────────────────────────────────────────────

/** Regex to find a PR number in a gh pr merge/review command. */
const PR_NUMBER_PATTERN = /\b(\d+)\b/;

/**
 * Extract the PR number from a gh command string.
 *
 * Handles: `gh pr merge 441`, `gh pr merge --squash 441`, `gh pr merge 441 --squash`.
 * Returns null if no number found (caller should fall back to `gh pr view`).
 */
export function extractPrNumber(command: string): number | null {
  // Strip the `gh pr merge` or `gh pr review` prefix to isolate args
  const argsMatch = command.match(/\bgh\s+pr\s+(?:merge|review)\s+(.*)/);
  if (!argsMatch) return null;

  const args = argsMatch[1];
  const match = args.match(PR_NUMBER_PATTERN);
  if (!match) return null;

  const num = parseInt(match[1], 10);
  return Number.isFinite(num) ? num : null;
}

/**
 * Resolve PR number from the current branch using `gh pr view`.
 * Returns null on any failure (fail-open).
 */
export function resolvePrFromBranch(deps: SharedDeps): number | null {
  const result = deps.exec("gh pr view --json number --jq .number");
  if (!result.ok) return null;

  const num = parseInt(result.value.trim(), 10);
  return Number.isFinite(num) ? num : null;
}

// ─── CI Status Checking ──────────────────────────────────────────────────────

/**
 * Check CI status for a PR via `gh pr checks`.
 *
 * Returns a CiStatus with failing/pending checks and an allPassing flag.
 * Returns null on gh CLI failure (caller should fail open).
 */
export function checkCiStatus(prNumber: number, deps: SharedDeps): CiStatus | null {
  const result = deps.exec(
    `gh pr checks ${prNumber} --json name,state --jq '[.[] | select(.state != "SUCCESS" and .state != "SKIPPED")]`,
  );
  if (!result.ok) return null;

  const parseResult = tryCatch(
    () => JSON.parse(result.value.trim()) as CiCheck[],
    (cause) => jsonParseFailed(result.value.trim().slice(0, 100), cause),
  );
  if (!parseResult.ok) return null;

  const checks = parseResult.value;
  const failing = checks.filter((c) => c.state === "FAILURE");
  const pending = checks.filter((c) => c.state === "PENDING");

  return {
    failing,
    pending,
    allPassing: failing.length === 0 && pending.length === 0,
  };
}

// ─── Review Status Checking ──────────────────────────────────────────────────

/**
 * Check review status for a PR via `gh pr view`.
 *
 * Returns a ReviewStatus with approved reviews and a hasApproval flag.
 * Returns null on gh CLI failure (caller should fail open).
 */
export function checkReviewStatus(prNumber: number, deps: SharedDeps): ReviewStatus | null {
  const result = deps.exec(`gh pr view ${prNumber} --json reviews --jq '.reviews'`);
  if (!result.ok) return null;

  const parseResult = tryCatch(
    () => JSON.parse(result.value.trim()) as Array<{ author: { login: string }; state: string }>,
    (cause) => jsonParseFailed(result.value.trim().slice(0, 100), cause),
  );
  if (!parseResult.ok) return null;

  const all: Review[] = parseResult.value.map((r) => ({
    author: r.author.login,
    state: r.state,
  }));
  const approved = all.filter((r) => r.state === "APPROVED");

  return {
    approved,
    all,
    hasApproval: approved.length > 0,
  };
}
