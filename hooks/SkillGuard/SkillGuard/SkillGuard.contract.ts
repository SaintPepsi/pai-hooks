/**
 * SkillGuard Contract — Block false-positive skill invocations.
 *
 * Prevents position-biased skills (keybindings-help) from firing
 * on unrelated prompts.
 */

import type { SyncHookContract } from "@hooks/core/contract";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput, BlockOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { pickNarrative } from "@hooks/lib/narrative-reader";

export const BLOCKED_SKILLS = ["keybindings-help"];

export const SkillGuard: SyncHookContract<
  ToolHookInput,
  ContinueOutput | BlockOutput,
  Record<string, never>
> = {
  name: "SkillGuard",
  event: "PreToolUse",

  accepts(_input: ToolHookInput): boolean {
    return true;
  },

  execute(input: ToolHookInput): Result<ContinueOutput | BlockOutput, PaiError> {
    const skillName = ((input.tool_input?.skill as string) || "").toLowerCase().trim();

    if (BLOCKED_SKILLS.includes(skillName)) {
      const opener = pickNarrative("SkillGuard", 1);
      return ok({
        type: "block",
        decision: "block",
        reason: `${opener}\n\n"${skillName}" is a known false-positive triggered by position bias. If the user genuinely wants keybinding help, they will explicitly say "keybindings" or use /keybindings-help.`,
      });
    }

    return ok({ type: "continue", continue: true });
  },

  defaultDeps: {},
};
