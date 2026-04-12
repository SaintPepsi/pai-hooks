import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  type CitationEnforcementDeps,
  defaultDeps,
  flagPath,
  remindedPath,
} from "@hooks/hooks/ObligationStateMachines/CitationEnforcement.shared";
import { pickNarrative } from "@hooks/lib/narrative-reader";
import { getFilePath } from "@hooks/lib/tool-input";

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

export const CitationEnforcement: SyncHookContract<ToolHookInput, CitationEnforcementDeps> = {
  name: "CitationEnforcement",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "Write" || input.tool_name === "Edit";
  },

  execute(
    input: ToolHookInput,
    deps: CitationEnforcementDeps,
  ): Result<SyncHookJSONOutput, ResultError> {
    const flag = flagPath(deps.stateDir);
    if (!deps.fileExists(flag)) {
      return ok({ continue: true });
    }

    const filePath = getFilePath(input);
    if (!filePath) {
      return ok({ continue: true });
    }

    const reminded = deps.readReminded(remindedPath(deps.stateDir));
    if (reminded.includes(filePath)) {
      return ok({ continue: true });
    }

    reminded.push(filePath);
    deps.writeReminded(remindedPath(deps.stateDir), reminded);
    deps.stderr(`[CitationEnforcement] Injecting citation reminder for ${filePath}`);

    // R2: PostToolUse context injection via hookSpecificOutput.additionalContext.
    // Post-SDK-refactor, fixes a bug where the legacy top-level `additionalContext` from
    // `continueOk(buildCitationReminder())` was silently dropped for PostToolUse events —
    // same bug class as PreCompactStatePersist 1A fix, applied here via R2 instead of R3.
    return ok({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: buildCitationReminder(),
      },
    });
  },

  defaultDeps,
};
