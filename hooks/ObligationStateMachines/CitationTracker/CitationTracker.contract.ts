import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  type CitationEnforcementDeps,
  defaultDeps,
  flagPath,
  isResearchSkill,
  RESEARCH_TOOLS,
} from "@hooks/hooks/ObligationStateMachines/CitationEnforcement.shared";

export const CitationTracker: SyncHookContract<ToolHookInput, CitationEnforcementDeps> = {
  name: "CitationTracker",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    if (RESEARCH_TOOLS.has(input.tool_name)) return true;
    if (isResearchSkill(input)) return true;
    return false;
  },

  execute(
    _input: ToolHookInput,
    deps: CitationEnforcementDeps,
  ): Result<SyncHookJSONOutput, ResultError> {
    const flag = flagPath(deps.stateDir);
    deps.writeFlag(flag);
    deps.stderr("[CitationTracker] Research tool detected — citation enforcement active");
    return ok({ continue: true });
  },

  defaultDeps,
};
