/**
 * VoiceGate Contract — Block voice curls from subagents.
 *
 * Only the main terminal session may curl localhost:8888.
 * Subagents get blocked silently.
 */

import type { HookContract } from "../core/contract";
import type { ToolHookInput } from "../core/types/hook-inputs";
import type { ContinueOutput, BlockOutput } from "../core/types/hook-outputs";
import { ok, type Result } from "../core/result";
import type { PaiError } from "../core/error";
import { fileExists } from "../core/adapters/fs";
import { join } from "path";
import { homedir } from "os";

export interface VoiceGateDeps {
  existsSync: (path: string) => boolean;
  getTermProgram: () => string | undefined;
  getItermSessionId: () => string | undefined;
  getPaiDir: () => string;
}

const defaultDeps: VoiceGateDeps = {
  existsSync: fileExists,
  getTermProgram: () => process.env.TERM_PROGRAM,
  getItermSessionId: () => process.env.ITERM_SESSION_ID,
  getPaiDir: () => process.env.PAI_DIR || join(homedir(), ".claude"),
};

function isMainSession(sessionId: string, deps: VoiceGateDeps): boolean {
  const termProgram = deps.getTermProgram();
  if (
    termProgram === "iTerm.app" ||
    termProgram === "WarpTerminal" ||
    termProgram === "Alacritty" ||
    termProgram === "Apple_Terminal" ||
    deps.getItermSessionId()
  ) {
    return true;
  }

  const kittySessionsDir = join(deps.getPaiDir(), "MEMORY", "STATE", "kitty-sessions");
  if (!deps.existsSync(kittySessionsDir)) return true;
  return deps.existsSync(join(kittySessionsDir, `${sessionId}.json`));
}

export const VoiceGate: HookContract<
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
    if (isMainSession(input.session_id, deps)) {
      return ok({ type: "continue", continue: true });
    }

    return ok({
      type: "block",
      decision: "block",
      reason: "Voice notifications are only sent from the main session. Subagent voice curls are suppressed.",
    });
  },

  defaultDeps,
};
