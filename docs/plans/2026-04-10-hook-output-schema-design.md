# Hook Output Schema — Investigation & Design

**Date:** 2026-04-10
**Status:** In Progress
**Trigger:** PreCompactStatePersist hook failing with `Hook JSON output validation failed: Invalid input`

## Problem

Two classes of hook output validation failures:

1. **Invalid hookEventName** — `hookSpecificOutput` with `hookEventName: "PreCompact"` rejected because `PreCompact` is not in Claude Code's discriminated union
2. **Mismatched hookEventName** — Outputting `hookEventName: "PostToolUse"` from a `SessionStart` hook rejected with `Hook returned incorrect event name: expected 'SessionStart' but got 'PostToolUse'`

**Root cause:** The runner's `formatOutput` function (`core/runner.ts:50-89`) blindly stamps the resolved event name into `hookSpecificOutput.hookEventName` for any hook returning `ContinueOutput` with `additionalContext`. It doesn't check whether the event is in the validated union.

## Source of Truth

The `@anthropic-ai/claude-agent-sdk` TypeScript package defines the exact output schema.

- Hooks reference: https://code.claude.com/docs/en/agent-sdk/hooks
- SDK reference: https://code.claude.com/docs/en/agent-sdk/typescript
- GitHub: https://github.com/anthropics/claude-agent-sdk-typescript

## Claude Code's hookSpecificOutput Schema

`hookSpecificOutput` is a discriminated union keyed on `hookEventName`. Only these events appear in the union:

| hookEventName        | Fields                                                                                | Notes                      |
| -------------------- | ------------------------------------------------------------------------------------- | -------------------------- |
| `PreToolUse`         | `permissionDecision`, `permissionDecisionReason`, `updatedInput`, `additionalContext` | Most complex variant       |
| `PostToolUse`        | `additionalContext`, `updatedMCPToolOutput`                                           | MCP output replacement     |
| `PostToolUseFailure` | `additionalContext`                                                                   | Context only               |
| `UserPromptSubmit`   | `additionalContext`                                                                   | Context only               |
| `SessionStart`       | `additionalContext`                                                                   | Context only               |
| `Setup`              | `additionalContext`                                                                   | Context only               |
| `SubagentStart`      | `additionalContext`                                                                   | Context only               |
| `Notification`       | `additionalContext`                                                                   | Context only               |
| `PermissionRequest`  | `decision: { behavior: "allow" \| "deny", ... }`                                      | Nested discriminated union |

Source: https://code.claude.com/docs/en/agent-sdk/hooks

### Events NOT in the union

These events **cannot** use `hookSpecificOutput`:

- `PreCompact`
- `SessionEnd`
- `Stop`
- `SubagentStop`
- `TeammateIdle`
- `TaskCompleted`
- `ConfigChange`
- `WorktreeCreate`
- `WorktreeRemove`

### Top-level fields (all events)

Every sync hook output can include these top-level fields, regardless of event type:

```typescript
{
  continue?: boolean;
  suppressOutput?: boolean;
  stopReason?: string;
  decision?: "approve" | "block";
  systemMessage?: string;
  reason?: string;
  hookSpecificOutput?: /* union above */;
}
```

Source: https://code.claude.com/docs/en/agent-sdk/hooks — SyncHookJSONOutput type

## Impact on Existing Hooks

### PreCompactStatePersist (broken)

**Current behavior:** Returns `continueOk(summary)` which the runner formats as `{ hookSpecificOutput: { hookEventName: "PreCompact", additionalContext: "..." } }`. This fails validation because `PreCompact` is not in the union.

**Fix options:**

1. Use `systemMessage` at top level: `{ continue: true, systemMessage: "..." }` — untested
2. Use `ContextOutput` (raw text) — may not be supported for PreCompact
3. Accept that PreCompact can't inject context; persist to file and pick up on next UserPromptSubmit

### Any hook on unsupported events

Any hook firing on Stop, SessionEnd, SubagentStop, PreCompact, etc. that returns `ContinueOutput` with `additionalContext` will fail the same way.

## Design: Effect Schema Output Pipeline

New file: `core/types/hook-output-schema.ts`

### What it defines

1. **`HookSpecificOutput`** — Effect Schema discriminated union matching Claude Code's exact schema (9 variants)
2. **`SyncHookJSONOutput`** — Top-level output struct with optional fields
3. **`HOOK_SPECIFIC_EVENTS`** — Set of event names in the union (compile-time derived)
4. **`encodeHookOutput(output, eventName)`** — Maps internal `HookOutput` to Claude Code JSON, validates, returns string
5. **`validateHookOutput(raw)`** — Validates a raw object against the schema

### How it integrates with the runner

`runner.ts:executePipeline` currently calls `formatOutput(result.value, eventName)`. This gets replaced with `encodeHookOutput(result.value, eventName, io.writeErr)`. Same signature, same call site. The `formatOutput` function is deleted.

### Routing logic in `buildOutputObject`

```
ContinueOutput + additionalContext + event IN union  → hookSpecificOutput
ContinueOutput + additionalContext + event NOT in union → { continue: true, systemMessage: "..." }
ContinueOutput without context → { continue: true }
BlockOutput + PreToolUse → hookSpecificOutput with permissionDecision: "deny"
BlockOutput + other → { decision: "block", reason }
AskOutput → { decision: "ask", message }
UpdatedInputOutput → hookSpecificOutput with updatedInput
ContextOutput → raw text (bypasses schema)
SilentOutput → null (bypasses schema)
```

### Validation guarantees

- **Compile-time:** Effect Schema types prevent constructing invalid hookSpecificOutput variants
- **Runtime:** `encodeHookOutput` validates the built object against the schema before JSON.stringify
- **Fail-open:** Validation failures fall back to `{ continue: true }` with stderr warning

## Open Questions

1. **Does `systemMessage` work for PreCompact?** — Needs live testing. If it does, the fallback path in the encoder is correct. If not, PreCompact hooks that need context injection must use the two-hook relay pattern (persist to file on PreCompact, inject via UserPromptSubmit).

2. **Should the runner warn when a hook returns additionalContext on an unsupported event?** — Currently the encoder silently falls back to systemMessage. A stderr warning would help debug misconfigured hooks.

3. **PermissionRequest support** — The current runner has no PermissionRequest output path. The schema defines it but the encoder's `buildOutputObject` doesn't handle it yet. Add when needed.

## Files Changed

| File                                    | Change                                         |
| --------------------------------------- | ---------------------------------------------- |
| `core/types/hook-output-schema.ts`      | **New** — Effect Schema + encoder              |
| `core/runner.ts`                        | Replace `formatOutput` with `encodeHookOutput` |
| `core/runner.test.ts`                   | Update tests for new encoder                   |
| `core/types/hook-output-schema.test.ts` | **New** — Schema validation tests              |
