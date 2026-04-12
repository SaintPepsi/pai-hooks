import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { StopInput, ToolHookInput } from "@hooks/core/types/hook-inputs";

/**
 * Narrow SyncHookJSONOutput for Stop/SessionEnd block reason (R5: top-level decision/reason).
 * Stop is a NonHookSpecificEvent, so block decision lives at the top level rather than under
 * hookSpecificOutput. Returns the reason string when the output is a block, undefined otherwise.
 */
export function getReasonFromBlock(output: SyncHookJSONOutput): string | undefined {
  if ("decision" in output && output.decision === "block") {
    return "reason" in output ? output.reason : undefined;
  }
  return undefined;
}

/**
 * True when output has no decision and no hookSpecificOutput (R8 silent skip).
 * Accepts both `{}` and `{ continue: true }` — use for tracker (PostToolUse) tests
 * where either shape is valid.
 */
export function isSilentNoOp(output: SyncHookJSONOutput): boolean {
  return !("decision" in output) && !output.hookSpecificOutput;
}

/**
 * True when output is strictly an empty object (`{}`).
 * Use for Stop enforcer tests where the expected output is specifically `{}`
 * (not `{ continue: true }`), so accidental `{ continue: true }` is caught.
 */
export function isBareNoOp(output: SyncHookJSONOutput): boolean {
  return Object.keys(output).length === 0;
}

/**
 * Build a minimal ToolHookInput with the given tool name and input shape.
 * Default session_id is "test-session".
 */
export function buildToolInput(
  toolName: string,
  toolInput: Record<string, unknown> = {},
): ToolHookInput {
  return {
    session_id: "test-session",
    tool_name: toolName,
    tool_input: toolInput,
  };
}

/**
 * Build a minimal StopInput. Default session_id is "test-session".
 */
export function buildStopInput(sessionId = "test-session"): StopInput {
  return {
    session_id: sessionId,
  };
}
