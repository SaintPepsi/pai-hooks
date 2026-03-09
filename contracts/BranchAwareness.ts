/**
 * BranchAwareness Contract — Inject current git branch at session start.
 *
 * SessionStart hook that runs `git branch --show-current` and injects
 * the branch name into session context. One injection per session,
 * zero ongoing context cost.
 *
 * Skips for subagents. Fails silently if git command fails.
 */

import type { HookContract } from "@hooks/core/contract";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import type { ContextOutput, SilentOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { execSyncSafe } from "@hooks/core/adapters/process";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BranchAwarenessDeps {
  getBranch: () => string | null;
  isSubagent: () => boolean;
  stderr: (msg: string) => void;
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: BranchAwarenessDeps = {
  getBranch: () => {
    const result = execSyncSafe("git branch --show-current", { encoding: "utf-8" });
    if (!result.ok) return null;
    return result.value.trim() || null;
  },
  isSubagent: () => {
    const claudeProjectDir = process.env.CLAUDE_PROJECT_DIR || "";
    return (
      claudeProjectDir.includes("/.claude/Agents/") ||
      process.env.CLAUDE_AGENT_TYPE !== undefined
    );
  },
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

// ─── Contract ────────────────────────────────────────────────────────────────

export const BranchAwareness: HookContract<
  SessionStartInput,
  ContextOutput | SilentOutput,
  BranchAwarenessDeps
> = {
  name: "BranchAwareness",
  event: "SessionStart",

  accepts(_input: SessionStartInput): boolean {
    return true;
  },

  execute(
    _input: SessionStartInput,
    deps: BranchAwarenessDeps,
  ): Result<ContextOutput | SilentOutput, PaiError> {
    if (deps.isSubagent()) {
      return ok({ type: "silent" });
    }

    const branch = deps.getBranch();

    if (!branch) {
      deps.stderr("[BranchAwareness] Could not determine git branch — skipping");
      return ok({ type: "silent" });
    }

    deps.stderr(`[BranchAwareness] Current branch: ${branch}`);
    return ok({ type: "context", content: `Current git branch: \`${branch}\`` });
  },

  defaultDeps,
};
