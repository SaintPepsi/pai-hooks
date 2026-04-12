/**
 * Shared test helper factories for hook tests.
 *
 * Canonical location for ToolHookInput factories that were duplicated
 * across 40+ test files.
 */

import { join } from "node:path";
import type { HookEvent, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { removeDir } from "@hooks/core/adapters/fs";
import { buildChildEnv } from "@hooks/core/adapters/process";
import type { SessionStartInput, StopInput, ToolHookInput } from "@hooks/core/types/hook-inputs";

/**
 * Narrow SyncHookJSONOutput to additionalContext for a specific hookEventName.
 * Returns undefined when the output has no hookSpecificOutput or when the event
 * name does not match. Use for any R2/R7 context-injection assertion.
 */
export function getInjectedContextFor(
  output: SyncHookJSONOutput,
  eventName: HookEvent,
): string | undefined {
  const hs = output.hookSpecificOutput;
  if (!hs || hs.hookEventName !== eventName) return undefined;
  return "additionalContext" in hs ? hs.additionalContext : undefined;
}

/** Create a Write tool input for testing. */
export function makeWriteInput(filePath: string, content: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Write",
    tool_input: { file_path: filePath, content },
  };
}

/** Create an Edit tool input for testing. */
export function makeEditInput(filePath: string, oldString = "a", newString = "b"): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Edit",
    tool_input: {
      file_path: filePath,
      old_string: oldString,
      new_string: newString,
    },
  };
}

/** Create a generic tool input for testing. */
export function makeToolInput(toolName: string, filePath: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: toolName,
    tool_input: { file_path: filePath },
  };
}

/** Create a SessionStart input for testing. */
export function makeSessionStartInput(sessionId = "test-sess"): SessionStartInput {
  return { session_id: sessionId };
}

// ─── Hook Shell Runner ───────────────────────────────────────────────────────

let _hookRunId = 0;

/** Generate a unique session ID for hook shell tests. */
export function uniqueSessionId(base: string): string {
  return `${base}-${Date.now()}-${++_hookRunId}`;
}

/** Spawn a hook script with JSON stdin and capture stdout/stderr/exitCode.
 *  Sets PAI_DIR to a temp directory so hooks don't pollute the real filesystem. */
export async function runHookScript(
  hookPath: string,
  input: Record<string, unknown>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const tmpDir = join(import.meta.dir, `__hook-test-${Date.now()}-${++_hookRunId}__`);
  const proc = Bun.spawn(["bun", hookPath], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: buildChildEnv({ PAI_DIR: tmpDir }),
  });
  const writer = proc.stdin!;
  writer.write(JSON.stringify(input));
  writer.end();
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  removeDir(tmpDir);
  return { stdout: stdout.trim(), stderr, exitCode };
}

// ─── PreToolUse / PostToolUse Narrowing Helpers ──────────────────────────────

/** True if output is a PreToolUse ask (R5 confirmation channel). */
export function isPreToolUseAsk(output: SyncHookJSONOutput): boolean {
  const hs = output.hookSpecificOutput;
  return (
    hs?.hookEventName === "PreToolUse" &&
    "permissionDecision" in hs &&
    hs.permissionDecision === "ask"
  );
}

/** Get the PreToolUse ask reason if present, else empty string. */
export function getPreToolUseAskReason(output: SyncHookJSONOutput): string {
  const hs = output.hookSpecificOutput;
  if (hs?.hookEventName !== "PreToolUse" || !("permissionDecisionReason" in hs)) return "";
  return hs.permissionDecisionReason ?? "";
}

/** True if output is a PreToolUse deny (R4 canonical block channel). */
export function isPreToolUseDeny(output: SyncHookJSONOutput): boolean {
  const hs = output.hookSpecificOutput;
  return (
    hs?.hookEventName === "PreToolUse" &&
    "permissionDecision" in hs &&
    hs.permissionDecision === "deny"
  );
}

/** Get the PreToolUse deny reason if present, else empty string. */
export function getPreToolUseDenyReason(output: SyncHookJSONOutput): string {
  const hs = output.hookSpecificOutput;
  if (hs?.hookEventName !== "PreToolUse" || !("permissionDecisionReason" in hs)) return "";
  return hs.permissionDecisionReason ?? "";
}

/** Narrow SyncHookJSONOutput to PreToolUse additionalContext (R2 advisory channel). */
export function getPreToolUseAdvisory(output: SyncHookJSONOutput): string | undefined {
  const hs = output.hookSpecificOutput;
  if (!hs || hs.hookEventName !== "PreToolUse") return undefined;
  return "additionalContext" in hs ? hs.additionalContext : undefined;
}

/** Narrow SyncHookJSONOutput to PostToolUse additionalContext (R2 advisory channel). */
export function getPostToolUseAdvisory(output: SyncHookJSONOutput): string | undefined {
  const hs = output.hookSpecificOutput;
  if (!hs || hs.hookEventName !== "PostToolUse") return undefined;
  return "additionalContext" in hs ? hs.additionalContext : undefined;
}

// ─── Stop / Block Narrowing Helpers ─────────────────────────────────────────

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

// ─── No-Op / Continue Narrowing Helpers ─────────────────────────────────────

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
 * True when output is silent: no decision, no hookSpecificOutput, and no continue flag.
 * Stricter than isSilentNoOp — rejects `{ continue: true }`.
 * Use for multi-event hooks (e.g. SteeringRuleInjector) where continue signals a distinct state.
 */
export function isSilent(output: SyncHookJSONOutput): boolean {
  return !("decision" in output) && !output.hookSpecificOutput && output.continue !== true;
}

/**
 * True when output is `{ continue: true }` with no hookSpecificOutput and no decision.
 * Use for PreToolUse/PostToolUse hooks that pass through when no rules match.
 */
export function isBareContinue(output: SyncHookJSONOutput): boolean {
  return (
    output.continue === true &&
    !output.hookSpecificOutput &&
    !("decision" in output && output.decision)
  );
}

/**
 * True when output has `continue: true` (any shape).
 * Use for hooks where the continue flag is the only meaningful assertion.
 */
export function isContinue(output: SyncHookJSONOutput): boolean {
  return output.continue === true;
}

// ─── additionalContext (event-agnostic) ──────────────────────────────────────

/**
 * Narrow SyncHookJSONOutput to additionalContext regardless of hookEventName.
 * Use for multi-event hooks (e.g. SteeringRuleInjector) where the same execute()
 * method fires on SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, etc.
 * For single-event hooks, prefer the typed getInjectedContextFor(output, eventName).
 */
export function getAdditionalContext(output: SyncHookJSONOutput): string | undefined {
  const hs = output.hookSpecificOutput;
  if (!hs) return undefined;
  return "additionalContext" in hs ? hs.additionalContext : undefined;
}

// ─── Tool / Stop Input Factories ─────────────────────────────────────────────

/**
 * Build a minimal ToolHookInput with the given tool name and input shape.
 * Unlike makeToolInput(toolName, filePath), this takes arbitrary tool_input.
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
