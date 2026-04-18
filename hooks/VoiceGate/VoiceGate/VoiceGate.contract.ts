/**
 * VoiceGate Contract — Block voice server requests from subagents.
 *
 * Only the main terminal session may access the voice server (localhost:8888).
 * Subagents are blocked to prevent duplicate TTS notifications.
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { fileExists } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { isSubagentDefault } from "@hooks/lib/environment";

export interface VoiceGateDeps {
  existsSync: (path: string) => boolean;
  getIsSubagent: () => boolean;
}

const defaultDeps: VoiceGateDeps = {
  existsSync: fileExists,
  getIsSubagent: isSubagentDefault,
};

export const VoiceGate: SyncHookContract<ToolHookInput, VoiceGateDeps> = {
  name: "VoiceGate",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    const command = (input.tool_input?.command as string) || "";
    return command.includes("localhost:8888");
  },

  execute(_input: ToolHookInput, deps: VoiceGateDeps): Result<SyncHookJSONOutput, ResultError> {
    if (!deps.getIsSubagent()) {
      return ok({ continue: true });
    }

    // L14 tombstone: bug #11 (R4-vs-R5 class) — top-level `decision:"block"` shape
    // is silently dropped on PreToolUse; block MUST use hookSpecificOutput.permissionDecision.
    return ok({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "Voice server access is restricted to the main session. Subagent requests are suppressed to prevent duplicate TTS notifications.",
      },
    });
  },

  defaultDeps,
};
