# AgentExecutionGuard

## Overview

AgentExecutionGuard is a **PreToolUse** hook that warns when a non-fast agent is about to be spawned in the foreground without `run_in_background: true`. Running heavyweight agents in the foreground blocks the user interface, so this hook injects a system reminder telling the model to add the background flag.

This hook is advisory (returns `context`, never `block`). It works alongside AgentLifecycleStart and AgentLifecycleStop which track agent state, but AgentExecutionGuard focuses purely on spawn-time validation of the background execution pattern.

## Event

`PreToolUse` — fires before any Task tool invocation and injects a warning if a non-fast agent is missing `run_in_background: true`.

## When It Fires

- A Task tool call is about to execute (accepts all tool invocations)
- The tool input does NOT have `run_in_background: true`
- The agent is NOT a fast-tier type (not in the "Explore" list)
- The agent is NOT using a fast model (not "haiku")
- The agent prompt does NOT contain a `## Scope` section with `Timing: FAST`

It does **not** fire when:

- The tool input already has `run_in_background: true`
- The `subagent_type` is "Explore" (a known fast agent type)
- The model is "haiku" (a fast-tier model)
- The prompt contains `## Scope` with `Timing: FAST`

## What It Does

1. Checks if `run_in_background` is already set to `true` -- if so, returns `continue`
2. Checks if the agent type is in the fast-tier list (`Explore`) -- if so, returns `continue`
3. Checks if the model is a fast model (`haiku`) -- if so, returns `continue`
4. Checks if the prompt contains a `## Scope` section with `Timing: FAST` -- if so, returns `continue`
5. If none of the exemptions match, builds a `system-reminder` warning with fix instructions
6. Returns `context` output with the warning injected as additional context

```typescript
// Core detection: non-fast agent without background flag
if (toolInput.run_in_background === true) return ok({ continue: true });
if (FAST_AGENT_TYPES.includes(agentType)) return ok({ continue: true });
if (FAST_MODELS.includes(model)) return ok({ continue: true });

// VIOLATION: inject warning context
return ok({
  continue: true,
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    additionalContext: warning,
  },
});
```

## Examples

### Example 1: Heavyweight agent without background flag

> The model spawns a Task with `subagent_type: "CodeReview"` and no `run_in_background` set. AgentExecutionGuard detects the violation and injects a system reminder warning that the agent will block the UI, instructing the model to add `run_in_background: true` and use the poll-collect pattern.

### Example 2: Fast Explore agent passes through

> The model spawns a Task with `subagent_type: "Explore"`. AgentExecutionGuard recognizes this as a fast-tier agent and returns `continue` silently, allowing the foreground execution without warning.

## Dependencies

| Dependency                       | Type | Purpose                                                                                                         |
| -------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------- |
| `result`                         | core | Provides `ok()` for Result-based returns                                                                        |
| `contract`                       | core | `SyncHookContract` type definition                                                                              |
| `hook-inputs`                    | core | `ToolHookInput` type for PreToolUse events                                                                      |
| `@anthropic-ai/claude-agent-sdk` | SDK  | `SyncHookJSONOutput` union type (replaces local `ContinueOutput`/`ContextOutput` tombstoned in Phase 1 Task 1K) |

---

## History

**Phase 1 Task 1K (2026-04-11)** — Latent bug #22 fixed. The R7 context-injection site
at `AgentExecutionGuard.contract.ts:96` was emitting `ok({ type: "context", content: warning })`,
which became a silent drop after Phase 0 Task 0C (commit `3705810`) deleted the runner's
`formatOutput()` translation layer. `validateHookOutput` fail-opens on unrecognized shapes, so
the foreground-agent warning was dropped with no diagnostic. Fixed by migrating to the SDK's
verbose `hookSpecificOutput.additionalContext` shape for PreToolUse events, per recipe R7 in
`/Users/hogers/.claude/pai-hooks/docs/plans/2026-04-10-sdk-type-foundation-implementation.md:137-151`.
