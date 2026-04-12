/**
 * Effect Schema for hook outputs — validated against Claude Code's actual acceptance rules.
 *
 * Source of truth: @anthropic-ai/claude-agent-sdk hookSpecificOutput discriminated union.
 * Reference: https://code.claude.com/docs/en/agent-sdk/hooks
 *
 * Usage:
 *   import { validateHookOutput } from "@hooks/core/types/hook-output-schema";
 *   const result = validateHookOutput(contractOutput);
 *   if (result._tag === "Left") { ... validation failed ... }
 */

import type { SyncHookJSONOutput as SDKSyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { Schema } from "effect";
import type { IsEqual } from "type-fest";

// ─── Permission types (from SDK) ────────────────────────────────────────────

const PermissionBehavior = Schema.Literal("allow", "deny", "ask");

const PermissionMode = Schema.Literal(
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "dontAsk",
  "auto",
);

const PermissionUpdateDestination = Schema.Literal(
  "userSettings",
  "projectSettings",
  "localSettings",
  "session",
  "cliArg",
);

const PermissionRuleValue = Schema.Struct({
  toolName: Schema.String,
  ruleContent: Schema.optional(Schema.String),
});

const PermissionUpdate = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("addRules"),
    rules: Schema.Array(PermissionRuleValue),
    behavior: PermissionBehavior,
    destination: PermissionUpdateDestination,
  }),
  Schema.Struct({
    type: Schema.Literal("replaceRules"),
    rules: Schema.Array(PermissionRuleValue),
    behavior: PermissionBehavior,
    destination: PermissionUpdateDestination,
  }),
  Schema.Struct({
    type: Schema.Literal("removeRules"),
    rules: Schema.Array(PermissionRuleValue),
    behavior: PermissionBehavior,
    destination: PermissionUpdateDestination,
  }),
  Schema.Struct({
    type: Schema.Literal("setMode"),
    mode: PermissionMode,
    destination: PermissionUpdateDestination,
  }),
  Schema.Struct({
    type: Schema.Literal("addDirectories"),
    directories: Schema.Array(Schema.String),
    destination: PermissionUpdateDestination,
  }),
  Schema.Struct({
    type: Schema.Literal("removeDirectories"),
    directories: Schema.Array(Schema.String),
    destination: PermissionUpdateDestination,
  }),
);

// ─── hookSpecificOutput variants (discriminated on hookEventName) ────────────

const PreToolUseSpecific = Schema.Struct({
  hookEventName: Schema.Literal("PreToolUse"),
  permissionDecision: Schema.optional(Schema.Literal("allow", "deny", "ask", "defer")),
  permissionDecisionReason: Schema.optional(Schema.String),
  updatedInput: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
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
  sessionTitle: Schema.optional(Schema.String),
});

const SessionStartSpecific = Schema.Struct({
  hookEventName: Schema.Literal("SessionStart"),
  additionalContext: Schema.optional(Schema.String),
  initialUserMessage: Schema.optional(Schema.String),
  watchPaths: Schema.optional(Schema.Array(Schema.String)),
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
      updatedInput: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
      updatedPermissions: Schema.optional(Schema.Array(PermissionUpdate)),
    }),
    Schema.Struct({
      behavior: Schema.Literal("deny"),
      message: Schema.optional(Schema.String),
      interrupt: Schema.optional(Schema.Boolean),
    }),
  ),
});

const PermissionDeniedSpecific = Schema.Struct({
  hookEventName: Schema.Literal("PermissionDenied"),
  retry: Schema.optional(Schema.Boolean),
});

const ElicitationSpecific = Schema.Struct({
  hookEventName: Schema.Literal("Elicitation"),
  action: Schema.optional(Schema.Literal("accept", "decline", "cancel")),
  content: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

const ElicitationResultSpecific = Schema.Struct({
  hookEventName: Schema.Literal("ElicitationResult"),
  action: Schema.optional(Schema.Literal("accept", "decline", "cancel")),
  content: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
});

const CwdChangedSpecific = Schema.Struct({
  hookEventName: Schema.Literal("CwdChanged"),
  watchPaths: Schema.optional(Schema.Array(Schema.String)),
});

const FileChangedSpecific = Schema.Struct({
  hookEventName: Schema.Literal("FileChanged"),
  watchPaths: Schema.optional(Schema.Array(Schema.String)),
});

const WorktreeCreateSpecific = Schema.Struct({
  hookEventName: Schema.Literal("WorktreeCreate"),
  worktreePath: Schema.String,
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
  PermissionDeniedSpecific,
  ElicitationSpecific,
  ElicitationResultSpecific,
  CwdChangedSpecific,
  FileChangedSpecific,
  WorktreeCreateSpecific,
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
// ─── Validation ─────────────────────────────────────────────────────────────

const validateSync = Schema.decodeUnknownEither(SyncHookJSONOutput);

/**
 * Validate a raw object against the Claude Code sync hook output schema.
 * Returns Either — Right(output) on success, Left(error) on failure.
 */
export function validateHookOutput(raw: unknown): ReturnType<typeof validateSync> {
  return validateSync(raw);
}

// ─── SDK Drift Protection ───────────────────────────────────────────────────
//
// Compile-time assertion: if the SDK and Effect Schema top-level keys diverge, this fails.
// We check key equality rather than deep structural equality because Effect Schema uses
// `readonly` modifiers the SDK doesn't. This catches field additions/removals/renames.
// hookSpecificOutput variants are checked via HookSpecificEventName in hook-output-helpers.ts.
//
// Note: Schema.Unknown is only used where types are genuinely dynamic:
// - updatedInput: tool input varies per tool
// - updatedMCPToolOutput: MCP server output varies per server
// - content: elicitation content based on requestedSchema

type SDKKeys = keyof SDKSyncHookJSONOutput;
type SchemaKeys = keyof SyncHookJSONOutputType;

type _SDKHasAllSchemaKeys = IsEqual<SchemaKeys, SDKKeys>;
const _keyDriftCheck: _SDKHasAllSchemaKeys = true;
