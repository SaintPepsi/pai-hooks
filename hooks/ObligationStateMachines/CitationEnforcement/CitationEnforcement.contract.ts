import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { getFilePath } from "@hooks/lib/tool-input";
import { continueOk } from "@hooks/core/types/hook-outputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import {
  type CitationEnforcementDeps,
  defaultDeps,
  flagPath,
  remindedPath,
} from "@hooks/hooks/ObligationStateMachines/CitationEnforcement.shared";
import { pickNarrative } from "@hooks/lib/narrative-reader";

function buildCitationReminder(): string {
  const opener = pickNarrative("CitationEnforcement", 1, import.meta.dir);
  return [
    opener,
    "Ensure every factual claim in your written content includes a citation:",
    "  - URLs for web sources",
    "  - File paths for codebase facts",
    "  - Documentation section names for framework claims",
    "'According to X' is not a citation. A citation is a link the user can follow.",
  ].join("\n");
}

export const CitationEnforcement: SyncHookContract<
  ToolHookInput,
  ContinueOutput,
  CitationEnforcementDeps
> = {
  name: "CitationEnforcement",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "Write" || input.tool_name === "Edit";
  },

  execute(input: ToolHookInput, deps: CitationEnforcementDeps): Result<ContinueOutput, PaiError> {
    const flag = flagPath(deps.stateDir);
    if (!deps.fileExists(flag)) {
      return ok(continueOk());
    }

    const filePath = getFilePath(input);
    if (!filePath) {
      return ok(continueOk());
    }

    const reminded = deps.readReminded(remindedPath(deps.stateDir));
    if (reminded.includes(filePath)) {
      return ok(continueOk());
    }

    reminded.push(filePath);
    deps.writeReminded(remindedPath(deps.stateDir), reminded);
    deps.stderr(`[CitationEnforcement] Injecting citation reminder for ${filePath}`);

    return ok(continueOk(buildCitationReminder()));
  },

  defaultDeps,
};
