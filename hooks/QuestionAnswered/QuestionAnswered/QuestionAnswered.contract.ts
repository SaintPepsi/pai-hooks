/**
 * QuestionAnswered Contract — No-op after kitty tab removal.
 *
 * Previously restored terminal tab color after AskUserQuestion.
 * Tab manipulation removed with kitty dependency (#56).
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { defaultStderr } from "@hooks/lib/paths";

export interface QuestionAnsweredDeps {
  stderr: (msg: string) => void;
}

const defaultDeps: QuestionAnsweredDeps = {
  stderr: defaultStderr,
};

export const QuestionAnswered: SyncHookContract<ToolHookInput, QuestionAnsweredDeps> = {
  name: "QuestionAnswered",
  event: "PostToolUse",

  accepts(_input: ToolHookInput): boolean {
    return true; // Matcher in settings.json handles AskUserQuestion filtering
  },

  execute(
    _input: ToolHookInput,
    _deps: QuestionAnsweredDeps,
  ): Result<SyncHookJSONOutput, ResultError> {
    return ok({});
  },

  defaultDeps,
};
