/**
 * VoiceGate Contract — Block voice server requests from subagents.
 *
 * Only the main terminal session may access the voice server (localhost:8888).
 * Subagents are blocked to prevent duplicate TTS notifications.
 */

import type { SyncHookContract } from "@hooks/core/contract";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput, BlockOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { fileExists } from "@hooks/core/adapters/fs";
import { join } from "path";

export interface VoiceGateDeps {
  existsSync: (path: string) => boolean;
  getIsSubagent: () => boolean;
}

const defaultDeps: VoiceGateDeps = {
  existsSync: fileExists,
  getIsSubagent: () => process.env.CLAUDE_CODE_AGENT_SUBAGENT === "true",
};

export const VoiceGate: SyncHookContract<
  ToolHookInput,
  ContinueOutput | BlockOutput,
  VoiceGateDeps
> = {
  name: "VoiceGate",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    const command = (input.tool_input?.command as string) || "";
    return command.includes("localhost:8888");
  },

  execute(
    input: ToolHookInput,
    deps: VoiceGateDeps,
  ): Result<ContinueOutput | BlockOutput, PaiError> {
    if (!deps.getIsSubagent()) {
      return ok({ type: "continue", continue: true });
    }

    return ok({
      type: "block",
      decision: "block",
      reason: "Voice server access is restricted to the main session. Subagent requests are suppressed to prevent duplicate TTS notifications.",
    });
  },

  defaultDeps,
};
