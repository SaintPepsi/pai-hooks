import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { getCommand, getFilePath } from "@hooks/lib/tool-input";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import {
  defaultDeps,
  defaultTrackerExcludeDeps,
  extractTestedSourceFiles,
  isNonTestCodeFile,
  isTestCommand,
  matchesExcludePattern,
  pendingMatchesSource,
  pendingPath,
  type TestObligationDeps,
  type TestTrackerExcludeDeps,
} from "@hooks/hooks/ObligationStateMachines/TestObligationStateMachine.shared";

export type TestTrackerDeps = TestObligationDeps & TestTrackerExcludeDeps;

export const TestObligationTracker: SyncHookContract<
  ToolHookInput,
  ContinueOutput,
  TestTrackerDeps
> = {
  name: "TestObligationTracker",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    if (input.tool_name === "Bash") return true;

    if (input.tool_name === "Edit" || input.tool_name === "Write") {
      const filePath = getFilePath(input);
      if (!filePath) return false;
      return isNonTestCodeFile(filePath);
    }

    return false;
  },

  execute(input: ToolHookInput, deps: TestTrackerDeps): Result<ContinueOutput, PaiError> {
    const flagFile = pendingPath(deps.stateDir, input.session_id);

    if (input.tool_name === "Bash") {
      const command = getCommand(input);
      if (command && isTestCommand(command) && deps.fileExists(flagFile)) {
        const testedSources = extractTestedSourceFiles(command);

        if (testedSources === null) {
          deps.removeFlag(flagFile);
          deps.stderr("[TestObligationTracker] Full test suite run — clearing all pending");
        } else {
          const pending = deps.readPending(flagFile);
          const remaining = pending.filter(
            (p) => !testedSources.some((s) => pendingMatchesSource(p, s)),
          );

          if (remaining.length === 0) {
            deps.removeFlag(flagFile);
            deps.stderr("[TestObligationTracker] All pending files tested — clearing flag");
          } else {
            deps.writePending(flagFile, remaining);
            deps.stderr(
              `[TestObligationTracker] Cleared tested files, ${remaining.length} still pending`,
            );
          }
        }
      }
      return ok({ type: "continue", continue: true });
    }

    const filePath = getFilePath(input);
    if (!filePath) {
      return ok({ type: "continue", continue: true });
    }

    const excludePatterns = deps.getExcludePatterns();
    if (excludePatterns.length > 0 && matchesExcludePattern(filePath, excludePatterns)) {
      deps.stderr(`[TestObligationTracker] Excluded: ${filePath}`);
      return ok({ type: "continue", continue: true });
    }

    const pending = deps.readPending(flagFile);
    if (!pending.includes(filePath)) {
      pending.push(filePath);
    }
    deps.writePending(flagFile, pending);
    deps.stderr(`[TestObligationTracker] Code modified: ${filePath} — tests pending`);

    return ok({ type: "continue", continue: true });
  },

  defaultDeps: { ...defaultDeps, ...defaultTrackerExcludeDeps },
};
