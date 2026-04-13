import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
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
import { getFilePath } from "@hooks/lib/tool-input";

export type DocTrackerDeps = DocObligationDeps & DocTrackerExcludeDeps;

export const DocObligationTracker: SyncHookContract<ToolHookInput, DocTrackerDeps> = {
  name: "DocObligationTracker",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    if (projectHasHook("DocObligationTracker")) return false;
    if (input.tool_name !== "Edit" && input.tool_name !== "Write") return false;
    const filePath = getFilePath(input);
    if (!filePath) return false;
    return isDocFile(filePath) || isNonTestCodeFile(filePath);
  },

  execute(input: ToolHookInput, deps: DocTrackerDeps): Result<SyncHookJSONOutput, ResultError> {
    const filePath = getFilePath(input);
    if (!filePath) {
      return ok({ continue: true });
    }

    const flagFile = pendingPath(deps.stateDir, input.session_id);

    if (isDocFile(filePath)) {
      if (!deps.fileExists(flagFile)) {
        return ok({ continue: true });
      }

      const pending = deps.readPending(flagFile);
      const remaining = pending.filter((p) => !isRelatedDoc(filePath, p));

      if (remaining.length === 0) {
        deps.removeFlag(flagFile);
      } else {
        deps.writePending(flagFile, remaining);
      }

      return ok({ continue: true });
    }

    const excludePatterns = deps.getExcludePatterns();
    if (excludePatterns.length > 0 && matchesDocExcludePattern(filePath, excludePatterns)) {
      return ok({ continue: true });
    }

    const pending = deps.readPending(flagFile);
    if (!pending.includes(filePath)) {
      pending.push(filePath);
    }
    deps.writePending(flagFile, pending);

    return ok({ continue: true });
  },

  defaultDeps: { ...defaultDeps, ...defaultDocTrackerExcludeDeps },
};
