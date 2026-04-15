## Overview

Typed input and output interfaces for all Claude Code hook events. Provides type safety between the JSON stdin that Claude Code sends and the contracts that consume it.

## Source of Truth

The `@anthropic-ai/claude-agent-sdk` package (v0.2.98+) is the authoritative source for hook types. It exports all input types (`*HookInput`), output types (`*HookSpecificOutput`, `SyncHookJSONOutput`), the event enum (`HookEvent`), and permission types (`HookPermissionDecision`). See: https://code.claude.com/docs/en/agent-sdk/hooks

**SDK Type Foundation refactor (complete):** Legacy `hook-outputs.ts` deleted in Phase 2A. Contracts return `SyncHookJSONOutput` directly from `@anthropic-ai/claude-agent-sdk`. Effect Schema remains for runtime validation only.

## Files

- **hook-inputs.ts** — Input types for each hook event (PreToolUse, PostToolUse, SessionStart, SessionEnd, UserPromptSubmit, PreCompact, Stop, SubagentStart, SubagentStop, PermissionRequest). Also exports per-tool input interfaces (`WriteToolInput`, `EditToolInput`, `BashToolInput`, `ReadToolInput`, `GlobToolInput`, `GrepToolInput`, `SkillToolInput`, `AgentToolInput`, `TaskCreateToolInput`, `TaskUpdateToolInput`) with typed fields and index signatures for backwards compatibility.
- **hook-input-schema.ts** — Effect Schema discriminated union on `hook_type`. Provides `parseHookInput(raw)` for validated parsing and `getEventType(input)` for type-safe event resolution. Replaces fragile `"field" in input` / `as Type` casts.
- **hook-output-schema.ts** — Effect Schema discriminated union covering all 15 SDK `hookSpecificOutput` variants plus supporting permission types. Exports `validateHookOutput(output)` for runtime validation. Includes a **compile-time drift guard** using type-fest's `IsEqual` that fails `tsc` if the Effect Schema's top-level keys diverge from the SDK's `SyncHookJSONOutput` type. Fully models `PermissionUpdate` (6-variant union: addRules, replaceRules, removeRules, setMode, addDirectories, removeDirectories) and supporting types (`PermissionBehavior`, `PermissionMode`, `PermissionUpdateDestination`, `PermissionRuleValue`). Only uses `Schema.Unknown` for genuinely dynamic types: `updatedInput` (tool input), `updatedMCPToolOutput` (MCP output), `content` (elicitation content).
- **hook-output-helpers.ts** — SDK-derived type aliases for compile-time safety. Exports `HookSpecificEventName` (extracted from `SyncHookJSONOutput["hookSpecificOutput"]["hookEventName"]` — the 15 events that support `hookSpecificOutput`) and `NonHookSpecificEvent` (derived as `Exclude<HookEvent, HookSpecificEventName>` — self-maintaining when the SDK adds events). Used by contracts that resolve the event name at runtime (e.g., SteeringRuleInjector) and by the barrel to re-export SDK-aligned type aliases. No runtime code — pure types.

## hookSpecificOutput Support

Not all events can use `hookSpecificOutput`. The SDK's discriminated union includes: PreToolUse, PostToolUse, PostToolUseFailure, UserPromptSubmit, SessionStart, Setup, SubagentStart, Notification, PermissionRequest, PermissionDenied, Elicitation, ElicitationResult, CwdChanged, FileChanged, WorktreeCreate.

Events **without** hookSpecificOutput support: PreCompact, PostCompact, SessionEnd, Stop, StopFailure, SubagentStop, TeammateIdle, TaskCreated, TaskCompleted, ConfigChange, WorktreeRemove, InstructionsLoaded.

## Key Types

- `ToolHookInput` — Used by PreToolUse and PostToolUse hooks. Contains `tool_name`, `tool_input`, optional `tool_response`.
- `StopInput` — Used by Stop hooks. Contains optional `transcript_path`, `last_assistant_message` (text of Claude's final response), and `stop_hook_active`.
- `PermissionRequestInput` — Used by PermissionRequest hooks. Contains `tool_name`, `tool_input`, optional `permission_mode` and `permission_suggestions`.
- `HookInput` — Union of all input types. Used by the runner for generic dispatch.
- `SyncHookJSONOutput` — From `@anthropic-ai/claude-agent-sdk`. The top-level JSON output structure Claude Code validates against. Contracts return this directly; the runner validates it via `validateHookOutput` (fail-open safety net) before serializing to stdout.
