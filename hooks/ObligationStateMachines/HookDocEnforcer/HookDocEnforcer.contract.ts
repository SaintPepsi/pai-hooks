import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { StopInput } from "@hooks/core/types/hook-inputs";
import { projectHasHook } from "@hooks/hooks/ObligationStateMachines/DocObligationStateMachine.shared";
import {
  buildDocSuggestions,
  defaultDeps,
  HOOK_DOC_CONFIG,
  readHookDocSettings,
} from "@hooks/hooks/ObligationStateMachines/HookDocStateMachine.shared";
import { pickNarrative } from "@hooks/lib/narrative-reader";
import type { ObligationDeps } from "@hooks/lib/obligation-machine";
import { checkObligation } from "@hooks/lib/obligation-machine";

export const HookDocEnforcer: SyncHookContract<StopInput, ObligationDeps> = {
  name: "HookDocEnforcer",
  event: "Stop",

  accepts(_input: StopInput): boolean {
    if (projectHasHook("HookDocEnforcer")) return false;
    const settings = readHookDocSettings();
    return settings.enabled;
  },

  execute(input: StopInput, deps: ObligationDeps): Result<SyncHookJSONOutput, ResultError> {
    const result = checkObligation(deps, HOOK_DOC_CONFIG, input.session_id);

    if (result.action === "silent" || result.action === "release") {
      return ok({});
    }

    const settings = readHookDocSettings();

    if (!settings.blocking) {
      deps.stderr(
        `[HookDocEnforcer] ${result.pending.length} hook(s) need docs (non-blocking mode)`,
      );
      return ok({});
    }

    const opener = pickNarrative("HookDocEnforcer", result.pending.length, import.meta.dir);
    const fileList = result.pending.map((f) => `  - ${f}`).join("\n");
    const suggestions = buildDocSuggestions(result.pending, settings);
    const reason = `${opener}\n\nHook source files modified without documentation:\n${fileList}\n\n${suggestions}`;

    // R5: Stop is a NonHookSpecificEvent — block via top-level decision/reason.
    return ok({ decision: "block", reason });
  },

  defaultDeps,
};
