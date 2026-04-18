/**
 * Effect Schema for hook inputs — discriminated union on hook_event_name.
 *
 * Replaces fragile `"field" in input` / `as SomeType` casts with
 * proper schema-validated parsing. The hook_event_name field from Claude Code
 * is the discriminator — no field-sniffing needed.
 *
 * Usage:
 *   import { parseHookInput } from "@hooks/core/types/hook-input-schema";
 *   const result = parseHookInput(rawJson);
 *   if (result._tag === "Right") { const input = result.right; }
 */

import { Schema } from "effect";

// ─── Base fields present on all inputs ─────────────────────────────────────

const HookInputBase = {
  session_id: Schema.String,
  hook_event_name: Schema.String,
};

// ─── Per-event schemas ─────────────────────────────────────────────────────

export const SessionStartInput = Schema.Struct({
  ...HookInputBase,
  hook_event_name: Schema.Literal("SessionStart"),
});

export const SessionEndInput = Schema.Struct({
  ...HookInputBase,
  hook_event_name: Schema.Literal("SessionEnd"),
  transcript_path: Schema.optional(Schema.String),
});

export const UserPromptSubmitInput = Schema.Struct({
  ...HookInputBase,
  hook_event_name: Schema.Literal("UserPromptSubmit"),
  prompt: Schema.optional(Schema.String),
  user_prompt: Schema.optional(Schema.String),
  transcript_path: Schema.optional(Schema.String),
});

export const PreToolUseInput = Schema.Struct({
  ...HookInputBase,
  hook_event_name: Schema.Literal("PreToolUse"),
  tool_name: Schema.String,
  tool_input: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

export const PostToolUseInput = Schema.Struct({
  ...HookInputBase,
  hook_event_name: Schema.Literal("PostToolUse"),
  tool_name: Schema.String,
  tool_input: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  tool_response: Schema.optional(Schema.Unknown),
});

export const StopInput = Schema.Struct({
  ...HookInputBase,
  hook_event_name: Schema.Literal("Stop"),
  transcript_path: Schema.optional(Schema.String),
  last_assistant_message: Schema.optional(Schema.String),
  stop_hook_active: Schema.optional(Schema.Boolean),
});

export const PreCompactInput = Schema.Struct({
  ...HookInputBase,
  hook_event_name: Schema.Literal("PreCompact"),
  trigger: Schema.optional(Schema.String),
});

export const SubagentStartInput = Schema.Struct({
  ...HookInputBase,
  hook_event_name: Schema.Literal("SubagentStart"),
  transcript_path: Schema.optional(Schema.String),
});

export const SubagentStopInput = Schema.Struct({
  ...HookInputBase,
  hook_event_name: Schema.Literal("SubagentStop"),
  transcript_path: Schema.optional(Schema.String),
});

export const PermissionRequestInput = Schema.Struct({
  ...HookInputBase,
  hook_event_name: Schema.Literal("PermissionRequest"),
  tool_name: Schema.String,
  tool_input: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  permission_mode: Schema.optional(Schema.String),
});

// ─── Discriminated union ───────────────────────────────────────────────────

export const HookInput = Schema.Union(
  SessionStartInput,
  SessionEndInput,
  UserPromptSubmitInput,
  PreToolUseInput,
  PostToolUseInput,
  StopInput,
  PreCompactInput,
  SubagentStartInput,
  SubagentStopInput,
  PermissionRequestInput,
);

export type ParsedHookInput = typeof HookInput.Type;

// ─── Parser ────────────────────────────────────────────────────────────────

const decode = Schema.decodeUnknownEither(HookInput);

/**
 * Parse raw JSON (already parsed to unknown) into a typed HookInput.
 * Returns Either — Right(input) on success, Left(error) on failure.
 */
export function parseHookInput(raw: unknown): ReturnType<typeof decode> {
  return decode(raw);
}

/**
 * Extract the hook_event_name from a parsed input.
 * After schema validation, this is always a valid HookEventType string.
 */
export function getEventType(input: ParsedHookInput): string {
  return input.hook_event_name;
}
