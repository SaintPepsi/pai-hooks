# TestObligationEnforcer

## Overview

TestObligationEnforcer is a **Stop-event** hook that blocks session end when code files have been modified without tests being written or run. It works in tandem with TestObligationTracker (PostToolUse), which tracks which code files still need testing.

The hook distinguishes between files that need new tests written (no test file exists) and files that already have tests but need them to be run. It uses an escalating block mechanism with a configurable limit, writing a review document and releasing the session after the limit is reached.

## Event

`Stop` — fires when the user attempts to end a Claude Code session, blocking if test obligations remain unfulfilled.

## When It Fires

- The TestObligationTracker has recorded one or more code files with pending test obligations
- The user attempts to end their session (Stop event)
- The block count has not yet reached `MAX_BLOCKS`

It does **not** fire when:

- No code files were modified during the session (no pending flag file)
- All modified code files have had their tests written and run (pending list is empty)
- The block limit has already been reached (session is released with a review document)

## What It Does

1. Reads the pending file list from the session's obligation state file
2. If no pending file exists or the list is empty, returns `silent` (session proceeds)
3. Reads the current block count for this session
4. If the block limit (`MAX_BLOCKS`) has been reached, writes a review document and clears the flag files, releasing the session
5. Categorizes pending files into two groups:
   - **Needs writing**: no corresponding test file exists (checked via `hasTestFile`)
   - **Needs running**: a test file exists but tests haven't been run yet
6. Builds a block message with a narrative opener and the categorized file lists
7. Increments the block count and returns a `block` decision

```typescript
// Categorize pending files
for (const file of pending) {
  if (hasTestFile(file, deps.fileExists)) {
    needsRunning.push(file);
  } else {
    needsWriting.push(file);
  }
}
const reason = `${opener}\n\n${sections.join("\n\n")}`;
// R5 — Stop is a NonHookSpecificEvent, so block decision/reason go at the top level
// (NOT nested under hookSpecificOutput as PreToolUse permissionDecision would be).
return ok({ decision: "block", reason });
```

## Examples

### Example 1: New code without tests

> You create `src/validator.ts` but do not write any tests. When you try to end the session, TestObligationEnforcer blocks with: "Write and run tests for (no test file exists): src/validator.ts"

### Example 2: Existing tests not run

> You modify `src/parser.ts` which already has `src/parser.test.ts`. TestObligationEnforcer detects the test file exists but hasn't been run, and blocks with: "Run existing tests for: src/parser.ts"

### Example 3: Block limit reached

> After being blocked once without running tests, you attempt to end the session again. The enforcer reaches its block limit, writes a review document, clears pending flags, and releases the session.

## Dependencies

| Dependency                          | Type      | Purpose                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `narrative-reader`                  | lib       | Picks escalating narrative tone for block messages                                                                                                                                                                                                                                                                                    |
| `TestObligationStateMachine.shared` | shared    | Provides `pendingPath`, `blockCountPath`, `MAX_BLOCKS`, `buildBlockLimitReview`, `hasTestFile`                                                                                                                                                                                                                                        |
| `result`                            | core      | `ok` wrapper for Result type returns                                                                                                                                                                                                                                                                                                  |
| `@anthropic-ai/claude-agent-sdk`    | SDK types | `SyncHookJSONOutput` return type. R5 block path uses top-level `decision: "block"` + `reason` because Stop is a NonHookSpecificEvent and has no `hookSpecificOutput` wrapping (contrast with PreToolUse where deny goes through `hookSpecificOutput.permissionDecision`). R8 silent path is a bare `{}`. Post-SDK-refactor migration. |
