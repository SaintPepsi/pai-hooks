import type { SyncHookContract } from "@hooks/core/contract";
import type { StopInput } from "@hooks/core/types/hook-inputs";
import type { BlockOutput, SilentOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import type { ObligationDeps } from "@hooks/lib/obligation-machine";
import { checkObligation } from "@hooks/lib/obligation-machine";
import { projectHasHook } from "@hooks/hooks/ObligationStateMachines/DocObligationStateMachine.shared";
import { pickNarrative } from "@hooks/lib/narrative-reader";
import {
  defaultDeps,
  HOOK_DOC_CONFIG,
  readHookDocSettings,
  buildDocSuggestions,
} from "@hooks/hooks/ObligationStateMachines/HookDocStateMachine.shared";

export const HookDocEnforcer: SyncHookContract<
  StopInput,
  BlockOutput | SilentOutput,
  ObligationDeps
> = {
  name: "HookDocEnforcer",
  event: "Stop",

  accepts(_input: StopInput): boolean {
    if (projectHasHook("HookDocEnforcer")) return false;
    const settings = readHookDocSettings();
    return settings.enabled;
  },

  execute(
    input: StopInput,
    deps: ObligationDeps,
  ): Result<BlockOutput | SilentOutput, PaiError> {
    const result = checkObligation(deps, HOOK_DOC_CONFIG, input.session_id);

    if (result.action === "silent" || result.action === "release") {
      return ok({ type: "silent" });
    }

    const settings = readHookDocSettings();

    if (!settings.blocking) {
      deps.stderr(`[HookDocEnforcer] ${result.pending.length} hook(s) need docs (non-blocking mode)`);
      return ok({ type: "silent" });
    }

    const opener = pickNarrative("HookDocEnforcer", result.pending.length);
    const fileList = result.pending.map((f) => `  - ${f}`).join("\n");
    const suggestions = buildDocSuggestions(result.pending, settings);
    const reason = `${opener}\n\nHook source files modified without documentation:\n${fileList}\n\n${suggestions}`;

    return ok({ type: "block", decision: "block", reason });
  },

  defaultDeps,
};
