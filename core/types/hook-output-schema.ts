/**
 * Effect Schema for hook outputs — validated against Claude Code's actual acceptance rules.
 *
 * Source of truth: @anthropic-ai/claude-agent-sdk hookSpecificOutput discriminated union.
 * Reference: https://code.claude.com/docs/en/agent-sdk/hooks
 *
 * The hookSpecificOutput field is a discriminated union keyed on hookEventName.
 * Only certain events appear in the union — others (PreCompact, Stop, SessionEnd, etc.)
 * cannot use hookSpecificOutput at all.
 *
 * Usage:
 *   import { encodeHookOutput } from "@hooks/core/types/hook-output-schema";
 *   const json = encodeHookOutput(hookOutput, eventName);
 *   if (json !== null) io.write(json);
 */

import type { HookOutput } from "@hooks/core/types/hook-outputs";
import { Schema } from "effect";

// ─── hookSpecificOutput variants (discriminated on hookEventName) ────────────

const PreToolUseSpecific = Schema.Struct({
  hookEventName: Schema.Literal("PreToolUse"),
  permissionDecision: Schema.optional(Schema.Literal("allow", "deny", "ask")),
  permissionDecisionReason: Schema.optional(Schema.String),
  updatedInput: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  ),
  additionalContext: Schema.optional(Schema.String),
});

const PostToolUseSpecific = Schema.Struct({
  hookEventName: Schema.Literal("PostToolUse"),
  additionalContext: Schema.optional(Schema.String),
  updatedMCPToolOutput: Schema.optional(Schema.Unknown),
});

const PostToolUseFailureSpecific = Schema.Struct({
  hookEventName: Schema.Literal("PostToolUseFailure"),
  additionalContext: Schema.optional(Schema.String),
});

const UserPromptSubmitSpecific = Schema.Struct({
  hookEventName: Schema.Literal("UserPromptSubmit"),
  additionalContext: Schema.optional(Schema.String),
});

const SessionStartSpecific = Schema.Struct({
  hookEventName: Schema.Literal("SessionStart"),
  additionalContext: Schema.optional(Schema.String),
});

const SetupSpecific = Schema.Struct({
  hookEventName: Schema.Literal("Setup"),
  additionalContext: Schema.optional(Schema.String),
});

const SubagentStartSpecific = Schema.Struct({
  hookEventName: Schema.Literal("SubagentStart"),
  additionalContext: Schema.optional(Schema.String),
});

const NotificationSpecific = Schema.Struct({
  hookEventName: Schema.Literal("Notification"),
  additionalContext: Schema.optional(Schema.String),
});

const PermissionRequestSpecific = Schema.Struct({
  hookEventName: Schema.Literal("PermissionRequest"),
  decision: Schema.Union(
    Schema.Struct({
      behavior: Schema.Literal("allow"),
      updatedInput: Schema.optional(
        Schema.Record({ key: Schema.String, value: Schema.Unknown }),
      ),
    }),
    Schema.Struct({
      behavior: Schema.Literal("deny"),
      message: Schema.optional(Schema.String),
      interrupt: Schema.optional(Schema.Boolean),
    }),
  ),
});

// ─── hookSpecificOutput union ───────────────────────────────────────────────

export const HookSpecificOutput = Schema.Union(
  PreToolUseSpecific,
  PostToolUseSpecific,
  PostToolUseFailureSpecific,
  UserPromptSubmitSpecific,
  SessionStartSpecific,
  SetupSpecific,
  SubagentStartSpecific,
  NotificationSpecific,
  PermissionRequestSpecific,
);

export type HookSpecificOutputType = typeof HookSpecificOutput.Type;

// ─── Top-level sync output ──────────────────────────────────────────────────

export const SyncHookJSONOutput = Schema.Struct({
  continue: Schema.optional(Schema.Boolean),
  suppressOutput: Schema.optional(Schema.Boolean),
  stopReason: Schema.optional(Schema.String),
  decision: Schema.optional(Schema.Literal("approve", "block")),
  systemMessage: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  hookSpecificOutput: Schema.optional(HookSpecificOutput),
});

export type SyncHookJSONOutputType = typeof SyncHookJSONOutput.Type;

// ─── Events that support hookSpecificOutput ─────────────────────────────────

/**
 * Set of event names that appear in the hookSpecificOutput discriminated union.
 * Events not in this set cannot use hookSpecificOutput.
 */
export const HOOK_SPECIFIC_EVENTS = new Set([
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "UserPromptSubmit",
  "SessionStart",
  "Setup",
  "SubagentStart",
  "Notification",
  "PermissionRequest",
] as const);

// ─── Validation ─────────────────────────────────────────────────────────────

const validateSync = Schema.decodeUnknownEither(SyncHookJSONOutput);

/**
 * Validate a raw object against the Claude Code sync hook output schema.
 * Returns Either — Right(output) on success, Left(error) on failure.
 */
export function validateHookOutput(
  raw: unknown,
): ReturnType<typeof validateSync> {
  return validateSync(raw);
}

// ─── Encoder: internal HookOutput → Claude Code JSON ────────────────────────

/**
 * Encode an internal HookOutput into the JSON string Claude Code expects.
 *
 * Returns null for silent outputs, raw string for context outputs.
 * For all JSON outputs, validates against the schema before serializing.
 *
 * Falls back to { continue: true } on validation failure (fail-open).
 */
export function encodeHookOutput(
  output: HookOutput,
  eventName: string,
  onError?: (msg: string) => void,
): string | null {
  // Context and silent bypass JSON schema entirely
  if (output.type === "context") return output.content;
  if (output.type === "silent") return null;

  const obj = buildOutputObject(output, eventName);
  const result = validateSync(obj);

  if (result._tag === "Left") {
    onError?.(
      `[hook-output-schema] validation failed for ${eventName}: ${result.left.message}`,
    );
    return JSON.stringify({ continue: true });
  }

  return JSON.stringify(obj);
}

// ─── Object builder (internal HookOutput → plain object) ────────────────────

function buildOutputObject(
  output: HookOutput,
  eventName: string,
): Record<string, unknown> {
  switch (output.type) {
    case "continue": {
      if (
        output.additionalContext !== undefined &&
        HOOK_SPECIFIC_EVENTS.has(eventName)
      ) {
        return {
          hookSpecificOutput: {
            hookEventName: eventName,
            additionalContext: output.additionalContext,
          },
        };
      }
      if (output.additionalContext !== undefined) {
        // Event doesn't support hookSpecificOutput — use systemMessage fallback
        return { continue: true, systemMessage: output.additionalContext };
      }
      return { continue: true };
    }

    case "block": {
      if (eventName === "PreToolUse") {
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: output.reason,
          },
        };
      }
      return { decision: "block", reason: output.reason };
    }

    case "ask":
      return { decision: "ask", message: output.message };

    case "updatedInput":
      return {
        hookSpecificOutput: {
          hookEventName: eventName,
          updatedInput: output.updatedInput,
        },
      };

    default:
      return { continue: true };
  }
}
