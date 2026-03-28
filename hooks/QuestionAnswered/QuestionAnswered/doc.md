# QuestionAnswered

## Overview

QuestionAnswered is a **PostToolUse** hook that resets the terminal tab state after the user answers an `AskUserQuestion` prompt. When Claude asks the user a question, the tab transitions to a "question" state (teal color). Once the user responds, this hook restores the tab to its previous "working" state (orange on inactive tabs only), preserving the original tab title when possible.

This hook works with the `tab-setter` library to manage terminal tab colors and titles across iTerm2 and Kitty terminals.

## Event

`PostToolUse` — fires after an `AskUserQuestion` tool completes, restoring the terminal tab from question state back to working state.

## When It Fires

- After any tool use completes (accepts returns true for all inputs)
- The `AskUserQuestion` tool filtering is handled by the matcher in `settings.json`, not the contract itself

It does **not** fire when:

- No tool has been used (only fires on PostToolUse)
- The settings.json matcher excludes the tool (filtering happens before the hook)

## What It Does

1. Reads the current tab state for the session using `readTabState`
2. Checks if a `previousTitle` was stored when the tab entered question state
3. If a previous title exists, strips any state prefix and uses it as the restored title
4. If no previous title is found, defaults to "Processing answer."
5. Sets the tab state back to "working" with a gear emoji prefix on the title
6. Logs the state transition to stderr

```typescript
// Restore tab to working state
const currentState = deps.readTabState(input.session_id);
let restoredTitle = "Processing answer.";

if (currentState?.previousTitle) {
  const rawTitle = deps.stripPrefix(currentState.previousTitle);
  if (rawTitle) restoredTitle = rawTitle;
}

deps.setTabState({
  title: "\u2699\uFE0F" + restoredTitle,
  state: "working",
  sessionId: input.session_id,
});
```

## Examples

### Example 1: Question answered with prior title

> During a session titled "Refactoring auth module", Claude asks the user a question and the tab turns teal. The user answers. QuestionAnswered reads the stored previous title ("Refactoring auth module"), strips any prefix, and sets the tab back to working state with the title "Refactoring auth module" and orange coloring on inactive tabs.

### Example 2: Question answered without prior title

> Claude asks a question at the very start of a session before any title was set. The user answers. QuestionAnswered finds no `previousTitle` in the tab state and defaults to "Processing answer." as the restored title, setting the tab to working state.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `tab-setter` | lib | Provides `setTabState`, `readTabState`, and `stripPrefix` for terminal tab management |
| `result` | core | Provides `ok` and `Result` type for error handling |
