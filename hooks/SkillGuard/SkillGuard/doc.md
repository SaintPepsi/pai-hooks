# SkillGuard

## Overview

SkillGuard is a **PreToolUse** hook that blocks false-positive Skill tool invocations caused by position bias in skill matching. Certain skills (such as `keybindings-help`) are known to trigger on unrelated prompts due to their position in the skill list, creating noise and wasting tokens. Guards against common false triggers.

This hook maintains a blocklist of known false-positive skills and prevents them from firing unless the user explicitly requests them by name or via the slash command.

## Event

`PreToolUse` — fires before any tool invocation, checking if the Skill tool is about to invoke a known false-positive skill and blocking it if so.

## When It Fires

- Any tool invocation occurs (the `accepts` function returns true for all inputs)
- The tool input contains a `skill` field matching a blocked skill name (currently: `keybindings-help`)

It does **not** fire when:

- The skill name is not in the `BLOCKED_SKILLS` list
- The tool is not invoking a Skill (no `skill` field in input)
- The user explicitly types `/keybindings-help` or says "keybindings" (these are genuine requests that would not be intercepted at this layer)

## What It Does

1. Extracts the `skill` name from the tool input, normalizing to lowercase and trimming whitespace
2. Checks if the skill is in the `BLOCKED_SKILLS` list (`["keybindings-help"]`)
3. If blocked, picks a narrative opener and returns a block decision explaining the false-positive
4. If not blocked, returns `continue` to allow the tool invocation to proceed

```typescript
if (BLOCKED_SKILLS.includes(skillName)) {
  const opener = pickNarrative("SkillGuard", 1, import.meta.dir);
  return ok({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `${opener}\n\n"${skillName}" is a known false-positive triggered by position bias.`,
    },
  });
}
```

<!-- L12 tombstone: bug #12 (R4-vs-R5 class) — legacy `{ type: "block", decision: "block", reason }` shape was a silent-drop on PreToolUse; replaced with `hookSpecificOutput.permissionDecision: "deny"` via R4 migration (feat/sdk-type-foundation). -->

## Examples

### Example 1: False-positive keybindings-help blocked

> The user asks "how do I configure my editor theme?" and the skill matcher incorrectly selects `keybindings-help` due to position bias. SkillGuard intercepts the invocation and blocks it with a reason explaining that `keybindings-help` is a known false-positive. Claude proceeds to answer the question directly instead.

### Example 2: Legitimate skill invocation allowed

> The user invokes the `executing-plans` skill. SkillGuard checks the skill name, finds it is not in the blocked list, and returns `continue`. The skill loads normally.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `narrative-reader` | lib | Picks contextual narrative openers for block messages |
| `@anthropic-ai/claude-agent-sdk` | SDK | `SyncHookJSONOutput` return type; PreToolUse block via `hookSpecificOutput.permissionDecision: "deny"` (R4 shape, post-SDK-refactor bug #12 fix) |
