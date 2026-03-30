/**
 * BranchAwareness Contract — Inject current git branch at session start.
 *
 * SessionStart hook that runs `git branch --show-current` and injects
 * the branch name into session context. One injection per session,
 * zero ongoing context cost.
 *
 * Skips for subagents. Fails silently if git command fails.
 */

import { execSyncSafe } from "@hooks/core/adapters/process";
import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import { isSubagent } from "@hooks/lib/environment";
import type { ContextOutput, SilentOutput } from "@hooks/core/types/hook-outputs";
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

export const BranchAwareness: SyncHookContract<
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
