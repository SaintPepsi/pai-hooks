import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { getFilePath } from "@hooks/lib/tool-input";
import { continueOk } from "@hooks/core/types/hook-outputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import {
  type DocObligationDeps,
  type DocTrackerExcludeDeps,
  defaultDeps,
  defaultDocTrackerExcludeDeps,
  isDocFile,
  isNonTestCodeFile,
  isRelatedDoc,
  matchesDocExcludePattern,
  pendingPath,
  projectHasHook,
} from "@hooks/hooks/ObligationStateMachines/DocObligationStateMachine.shared";

export type DocTrackerDeps = DocObligationDeps & DocTrackerExcludeDeps;

export const DocObligationTracker: SyncHookContract<
  ToolHookInput,
  ContinueOutput,
  DocTrackerDeps
> = {
  name: "DocObligationTracker",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    if (projectHasHook("DocObligationTracker")) return false;
    if (input.tool_name !== "Edit" && input.tool_name !== "Write") return false;
    const filePath = getFilePath(input);
    if (!filePath) return false;
    return isDocFile(filePath) || isNonTestCodeFile(filePath);
  },

  execute(input: ToolHookInput, deps: DocTrackerDeps): Result<ContinueOutput, PaiError> {
    const filePath = getFilePath(input);
    if (!filePath) {
      return ok(continueOk());
    }

    const flagFile = pendingPath(deps.stateDir, input.session_id);

    if (isDocFile(filePath)) {
      if (!deps.fileExists(flagFile)) {
        return ok(continueOk());
      }

      const pending = deps.readPending(flagFile);
      const remaining = pending.filter((p) => !isRelatedDoc(filePath, p));

      if (remaining.length === 0) {
        deps.removeFlag(flagFile);
        deps.stderr("[DocObligationTracker] All pending files documented — clearing flag");
      } else {
        deps.writePending(flagFile, remaining);
        deps.stderr(
          `[DocObligationTracker] Cleared documented files, ${remaining.length} still pending`,
        );
      }

      return ok(continueOk());
    }

    const excludePatterns = deps.getExcludePatterns();
    if (excludePatterns.length > 0 && matchesDocExcludePattern(filePath, excludePatterns)) {
      deps.stderr(`[DocObligationTracker] Excluded: ${filePath}`);
      return ok(continueOk());
    }

    const pending = deps.readPending(flagFile);
    if (!pending.includes(filePath)) {
      pending.push(filePath);
    }
    deps.writePending(flagFile, pending);
    deps.stderr(`[DocObligationTracker] Code modified: ${filePath} — docs pending`);

    return ok(continueOk());
  },

  defaultDeps: { ...defaultDeps, ...defaultDocTrackerExcludeDeps },
};
