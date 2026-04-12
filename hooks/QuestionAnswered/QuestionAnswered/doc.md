# QuestionAnswered

## Overview

QuestionAnswered is a **PostToolUse** hook that fires after an `AskUserQuestion` tool completes. This hook is a no-op that returns `silent` immediately.

## Event

`PostToolUse` — fires after an `AskUserQuestion` tool completes. Returns `silent` immediately (no-op).

## When It Fires

- After any tool use completes (accepts returns true for all inputs)
- The `AskUserQuestion` tool filtering is handled by the matcher in `settings.json`

It does **not** fire when:

- No tool has been used (only fires on PostToolUse)

## What It Does

1. Returns `ok({})` immediately (silent no-op)

```typescript
execute(_input, _deps): Result<SyncHookJSONOutput, E> {
  return ok({});
}
```

## Examples

### Example 1: User answers a question

> Claude asks the user a question via `AskUserQuestion`. The user responds. QuestionAnswered fires and returns silent. No tab state changes occur.

## Dependencies

| Dependency | Type | Purpose                                            |
| ---------- | ---- | -------------------------------------------------- |
| `result`   | core | Provides `ok` and `Result` type for error handling |
