/**
 * QuestionAnswered Contract — Reset tab after question answered.
 *
 * Restores terminal tab from question state (teal) back to working
 * state (orange) after the user answers an AskUserQuestion.
 */

import type { HookContract } from "../core/contract";
import type { ToolHookInput } from "../core/types/hook-inputs";
import type { SilentOutput } from "../core/types/hook-outputs";
import { ok, type Result } from "../core/result";
import type { PaiError } from "../core/error";
import { setTabState, readTabState, stripPrefix } from "../lib/tab-setter";

export interface QuestionAnsweredDeps {
  setTabState: typeof setTabState;
  readTabState: typeof readTabState;
  stripPrefix: typeof stripPrefix;
  stderr: (msg: string) => void;
}

const defaultDeps: QuestionAnsweredDeps = {
  setTabState,
  readTabState,
  stripPrefix,
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const QuestionAnswered: HookContract<
  ToolHookInput,
  SilentOutput,
  QuestionAnsweredDeps
> = {
  name: "QuestionAnswered",
  event: "PostToolUse",

  accepts(_input: ToolHookInput): boolean {
    return true; // Matcher in settings.json handles AskUserQuestion filtering
  },

  execute(
    input: ToolHookInput,
    deps: QuestionAnsweredDeps,
  ): Result<SilentOutput, PaiError> {
    const currentState = deps.readTabState(input.session_id);
    let restoredTitle = "Processing answer.";

    if (currentState?.previousTitle) {
      const rawTitle = deps.stripPrefix(currentState.previousTitle);
      if (rawTitle) {
        restoredTitle = rawTitle;
      }
    }

    deps.setTabState({
      title: "\u2699\uFE0F" + restoredTitle,
      state: "working",
      sessionId: input.session_id,
    });

    deps.stderr("[QuestionAnswered] Tab reset to working state (orange on inactive only)");

    return ok({ type: "silent" });
  },

  defaultDeps,
};
