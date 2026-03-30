import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { getFilePath } from "@hooks/lib/tool-input";
import { continueOk } from "@hooks/core/types/hook-outputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import { projectHasHook } from "@hooks/hooks/ObligationStateMachines/DocObligationStateMachine.shared";
import {
  defaultDeps,
  getHookDirFromPath,
  isHookDocFile,
  isHookSourceFile,
  pendingPath,
  readHookDocSettings,
} from "@hooks/hooks/ObligationStateMachines/HookDocStateMachine.shared";
import type { ObligationDeps } from "@hooks/lib/obligation-machine";
import { addPending, clearMatching } from "@hooks/lib/obligation-machine";

export const HookDocTracker: SyncHookContract<ToolHookInput, ContinueOutput, ObligationDeps> = {
  name: "HookDocTracker",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    if (projectHasHook("HookDocTracker")) return false;
    if (input.tool_name !== "Edit" && input.tool_name !== "Write") return false;
    const filePath = getFilePath(input);
    if (!filePath) return false;
    const settings = readHookDocSettings();
    return (
      isHookSourceFile(filePath, settings.watchPatterns) ||
      isHookDocFile(filePath, settings.docFileName)
    );
  },

  execute(input: ToolHookInput, deps: ObligationDeps): Result<ContinueOutput, PaiError> {
    const filePath = getFilePath(input);
    if (!filePath) return ok(continueOk());

    const settings = readHookDocSettings();
    const flagFile = pendingPath(deps.stateDir, input.session_id);

    // Doc file written → clear matching pending entries from same hook directory
    if (isHookDocFile(filePath, settings.docFileName)) {
      const docDir = getHookDirFromPath(filePath);
      const { remaining, cleared } = clearMatching(deps, flagFile, (p) => {
        return getHookDirFromPath(p) === docDir;
      });

      if (cleared) {
        deps.stderr(
          remaining === 0
            ? "[HookDocTracker] All pending hooks documented — clearing flag"
            : `[HookDocTracker] Cleared documented hook, ${remaining} still pending`,
        );
      }
      return ok(continueOk());
    }

    // Hook source file modified → add to pending
    addPending(deps, flagFile, filePath);
    deps.stderr(`[HookDocTracker] Hook source modified: ${filePath} — docs pending`);
    return ok(continueOk());
  },

  defaultDeps,
};
