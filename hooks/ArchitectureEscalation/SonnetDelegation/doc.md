# SonnetDelegation

## Overview

SonnetDelegation is a **PostToolUse** hook that injects Sonnet subagent delegation guidance when the `executing-plans` skill loads. It provides structured instructions for classifying plan steps as either MECHANICAL (delegate to Sonnet) or REASONING (Opus handles directly), enabling efficient token usage by routing mechanical work to a lighter-weight model.

The hook has zero context cost when any other skill loads, as it only fires for the `executing-plans` skill specifically.

## Event

`PostToolUse` — fires after the Skill tool loads `executing-plans`, injecting delegation guidance as `additionalContext` so Opus knows how to dispatch plan steps to Sonnet subagents.

## When It Fires

- The tool used is `Skill`
- The skill being loaded is `"executing-plans"` or `"superpowers:executing-plans"`

It does **not** fire when:

- The tool is anything other than `Skill`
- A different skill is being loaded (e.g., `first-principles`, `council`)
- The skill name does not match exactly

## What It Does

1. Checks if the Skill tool is loading the `executing-plans` skill
2. Injects the delegation guidance as `additionalContext`, which includes:
   - Classification criteria for MECHANICAL steps (exact edits, pattern application, boilerplate)
   - Classification criteria for REASONING steps (architecture decisions, debugging, judgment)
   - Dispatch instructions for Sonnet subagents (`Agent(model: "sonnet", subagent_type: "Engineer")`)
   - Anti-requirements (Sonnet never makes architectural decisions, never modifies ISC/PRD content)

```typescript
// Delegation guidance injection
return ok({
  continue: true,
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: DELEGATION_GUIDANCE,
  },
});
```

## Examples

### Example 1: Plan execution with mixed step types

> Claude loads the `executing-plans` skill to execute a 10-step implementation plan. SonnetDelegation injects guidance instructing Opus to classify each step. Steps like "add error handling to 5 endpoints following the existing pattern" are dispatched to Sonnet as MECHANICAL, while "decide the caching strategy for the new API" stays with Opus as REASONING. Independent mechanical steps may run in parallel.

### Example 2: Other skill loads unaffected

> Claude loads the `first-principles` skill. SonnetDelegation's `accepts` returns false because the skill is not `executing-plans`. No guidance is injected and no context tokens are spent.

## Dependencies

| Dependency | Type | Purpose                                                  |
| ---------- | ---- | -------------------------------------------------------- |
| (none)     | --   | This hook has no external dependencies beyond core types |

## History

> **2026-04-11 — SDK Type Foundation (1M):** The delegation guidance injection at `SonnetDelegation.contract.ts:84` was using `continueOk(DELEGATION_GUIDANCE)` which routed `additionalContext` at the top level of the hook output. Claude Code's SDK silently dropped this field on PostToolUse. 9th instance of the same bug class found in this refactor. The fix routes `DELEGATION_GUIDANCE` through `hookSpecificOutput.additionalContext` with `hookEventName: "PostToolUse"`. Behaviour change: loading the `executing-plans` skill now actually delivers the Sonnet delegation guidance to Opus. Previously, the stderr log fired and metrics recorded the injection, but the classified instructions were never received by the model.
