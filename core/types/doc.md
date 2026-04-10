## Overview

Typed input and output interfaces for all Claude Code hook events. Provides type safety between the JSON stdin that Claude Code sends and the contracts that consume it.

## Source of Truth

The `@anthropic-ai/claude-agent-sdk` package (v0.2.98+) is the authoritative source for hook types. It exports all input types (`*HookInput`), output types (`*HookSpecificOutput`, `SyncHookJSONOutput`), the event enum (`HookEvent`), and permission types (`HookPermissionDecision`). See: https://code.claude.com/docs/en/agent-sdk/hooks

**Planned refactor:** Replace manually-defined types with SDK imports. Effect Schema remains for runtime validation only.

## Files

- **hook-inputs.ts** — Input types for each hook event (PreToolUse, PostToolUse, SessionStart, SessionEnd, UserPromptSubmit, PreCompact, Stop, SubagentStart, SubagentStop, PermissionRequest)
- **hook-input-schema.ts** — Effect Schema discriminated union on `hook_type`. Provides `parseHookInput(raw)` for validated parsing and `getEventType(input)` for type-safe event resolution. Replaces fragile `"field" in input` / `as Type` casts.
- **hook-outputs.ts** — Output types (ContinueOutput, BlockOutput, AskOutput, ContextOutput, UpdatedInputOutput, SilentOutput) with factory functions
- **hook-output-schema.ts** — Effect Schema for Claude Code's validated output format. Encodes which events support `hookSpecificOutput` (discriminated union on `hookEventName`) and provides `encodeHookOutput(output, eventName)` for schema-validated encoding. Events not in the union (PreCompact, Stop, SessionEnd, SubagentStop) fall back to `systemMessage` for context injection. Source: `SyncHookJSONOutput` from `@anthropic-ai/claude-agent-sdk`.

## hookSpecificOutput Support

Not all events can use `hookSpecificOutput`. The SDK's discriminated union includes: PreToolUse, PostToolUse, PostToolUseFailure, UserPromptSubmit, SessionStart, Setup, SubagentStart, Notification, PermissionRequest, PermissionDenied, Elicitation, ElicitationResult, CwdChanged, FileChanged, WorktreeCreate.

Events **without** hookSpecificOutput support: PreCompact, PostCompact, SessionEnd, Stop, StopFailure, SubagentStop, TeammateIdle, TaskCreated, TaskCompleted, ConfigChange, WorktreeRemove, InstructionsLoaded.

## Key Types

- `ToolHookInput` — Used by PreToolUse and PostToolUse hooks. Contains `tool_name`, `tool_input`, optional `tool_response`.
- `StopInput` — Used by Stop hooks. Contains optional `transcript_path`, `last_assistant_message` (text of Claude's final response), and `stop_hook_active`.
- `PermissionRequestInput` — Used by PermissionRequest hooks. Contains `tool_name`, `tool_input`, optional `permission_mode` and `permission_suggestions`.
- `HookInput` — Union of all input types. Used by the runner for generic dispatch.
- `HookOutput` — Union of all output types. Used by the runner for formatting.
- `SyncHookJSONOutput` — From `@anthropic-ai/claude-agent-sdk`. The top-level JSON output structure Claude Code validates against.
