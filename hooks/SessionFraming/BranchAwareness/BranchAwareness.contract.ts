/**
 * BranchAwareness Contract — Inject current git branch at session start.
 *
 * SessionStart hook that runs `git branch --show-current` and injects
 * the branch name into session context. One injection per session,
 * zero ongoing context cost.
 *
 * Skips for subagents. Fails silently if git command fails.
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { execSyncSafe } from "@hooks/core/adapters/process";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import { isSubagent } from "@hooks/lib/environment";
import { defaultStderr } from "@hooks/lib/paths";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BranchAwarenessDeps {
  getBranch: () => string | null;
  isSubagent: () => boolean;
  stderr: (msg: string) => void;
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: BranchAwarenessDeps = {
  getBranch: () => {
    const result = execSyncSafe("git branch --show-current");
    if (!result.ok) return null;
    return result.value.trim() || null;
  },
  isSubagent: () => isSubagent((k) => process.env[k]),
  stderr: defaultStderr,
};

// ─── Contract ────────────────────────────────────────────────────────────────

export const BranchAwareness: SyncHookContract<SessionStartInput, BranchAwarenessDeps> = {
  name: "BranchAwareness",
  event: "SessionStart",

  accepts(_input: SessionStartInput): boolean {
    return true;
  },

  execute(
    _input: SessionStartInput,
    deps: BranchAwarenessDeps,
  ): Result<SyncHookJSONOutput, ResultError> {
    if (deps.isSubagent()) {
      return ok({});
    }

    const branch = deps.getBranch();

    if (!branch) {
      deps.stderr("[BranchAwareness] Could not determine git branch — skipping");
      return ok({});
    }

    deps.stderr(`[BranchAwareness] Current branch: ${branch}`);
    return ok({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: `Current git branch: \`${branch}\``,
      },
    });
  },

  defaultDeps,
};
