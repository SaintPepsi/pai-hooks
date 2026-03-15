/**
 * ProtectedBranchGuard Contract — Block git mutations on main/master.
 *
 * PreToolUse hook that fires on Bash commands. Detects git commit, push,
 * and merge commands, checks the current branch, and blocks if on a
 * protected branch (main/master).
 *
 * Exempts configurable directories from protection (defaults: ~/.claude).
 * Fails open if branch cannot be determined.
 *
 * Pattern: pai-hooks/contracts/BashWriteGuard.ts
 */

import type { HookContract, SyncHookContract } from "@hooks/core/contract";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput, BlockOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { execSyncSafe } from "@hooks/core/adapters/process";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProtectedBranchGuardDeps {
  getBranch: () => string | null;
  getCwd: () => string;
  stderr: (msg: string) => void;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PROTECTED_BRANCHES = ["main", "master"];

// Directories exempt from branch protection. Paths matching any of these
// patterns can commit/push/merge on protected branches.
// ~/.claude is exempt because GitAutoSync legitimately commits there.
const EXEMPT_DIR_PATTERNS: RegExp[] = [
  /\/\.claude(?:\/|$)/,
  /\/claude-on-blackberry(?:\/|$)/,
];

// Matches git commit, git push, git merge (the mutation commands)
// Ref: https://git-scm.com/docs — these are the commands that modify history
const GIT_MUTATION_PATTERN = /\bgit\s+(commit|push|merge)\b/;

// ─── Pure Functions ─────────────────────────────────────────────────────────

/** Extract the command string from tool input. */
function getCommand(input: ToolHookInput): string {
  if (typeof input.tool_input === "string") return input.tool_input;
  return (input.tool_input?.command as string) || "";
}

/** Check if command contains a git mutation (commit/push/merge). */
function isGitMutation(command: string): boolean {
  return GIT_MUTATION_PATTERN.test(command);
}

/** Check if CWD is inside an exempt directory. */
function isExemptDir(cwd: string): boolean {
  return EXEMPT_DIR_PATTERNS.some(p => p.test(cwd));
}

// ─── Default Deps ───────────────────────────────────────────────────────────

const defaultDeps: ProtectedBranchGuardDeps = {
  getBranch: () => {
    const result = execSyncSafe("git branch --show-current");
    if (!result.ok) return null;
    return result.value.trim() || null;
  },
  getCwd: () => process.cwd(),
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

// ─── Contract ───────────────────────────────────────────────────────────────

export const ProtectedBranchGuard: SyncHookContract<
  ToolHookInput,
  ContinueOutput | BlockOutput,
  ProtectedBranchGuardDeps
> = {
  name: "ProtectedBranchGuard",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "Bash";
  },

  execute(
    input: ToolHookInput,
    deps: ProtectedBranchGuardDeps,
  ): Result<ContinueOutput | BlockOutput, PaiError> {
    const command = getCommand(input);

    // Only check git mutation commands (commit, push, merge)
    if (!isGitMutation(command)) {
      return ok({ type: "continue", continue: true });
    }

    // Exempt configured directories (e.g. ~/.claude for GitAutoSync)
    if (isExemptDir(deps.getCwd())) {
      return ok({ type: "continue", continue: true });
    }

    // Check current branch
    const branch = deps.getBranch();

    // Fail open if branch cannot be determined
    if (!branch) {
      deps.stderr("[ProtectedBranchGuard] Could not determine branch — allowing");
      return ok({ type: "continue", continue: true });
    }

    // Block if on a protected branch
    if (PROTECTED_BRANCHES.includes(branch)) {
      const reason = [
        `Protected branch guard: cannot run git mutations on '${branch}'.`,
        "",
        `Command: ${command.slice(0, 200)}`,
        "",
        "Create a feature branch first:",
        `  git checkout -b feature/your-feature`,
        "",
        "Then commit and push from the feature branch.",
      ].join("\n");

      deps.stderr(`[ProtectedBranchGuard] BLOCK: git mutation on protected branch '${branch}'`);

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
