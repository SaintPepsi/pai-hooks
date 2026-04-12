/**
 * Shared test helpers for CodingStandards hooks.
 *
 * After the SDK Type Foundation refactor, PreToolUse block tests assert against
 * `hookSpecificOutput.permissionDecision === "deny"` (R4 canonical channel) and
 * PreToolUse/PostToolUse advisory tests assert against
 * `hookSpecificOutput.additionalContext` (R2 channel).
 *
 * These narrow helpers centralize the SyncHookJSONOutput discrimination so that
 * per-hook test files don't duplicate the `hookEventName` + `permissionDecision` /
 * `additionalContext` narrowing logic.
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";

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
