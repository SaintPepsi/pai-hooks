# DocObligationEnforcer

## Overview

DocObligationEnforcer is a **Stop-event** hook that blocks session end when code files have been modified without corresponding documentation updates. It works in tandem with DocObligationTracker (PostToolUse), which tracks which code files still need documentation.

The hook uses an escalating block mechanism with a configurable limit. After the block limit is reached, it writes a review document and releases the session rather than blocking indefinitely.

## Event

`Stop` — fires when the user attempts to end a Claude Code session, blocking if documentation obligations remain unfulfilled.

## When It Fires

- The DocObligationTracker has recorded one or more code files with pending documentation
- The user attempts to end their session (Stop event)
- The block count has not yet reached `MAX_BLOCKS`

It does **not** fire when:

- No code files were modified during the session (no pending flag file)
- All modified code files have had their documentation updated (pending list is empty)
- A project-level `DocObligationEnforcer` hook exists (checked via `projectHasHook`)
- The block limit has already been reached (session is released with a review document)

## What It Does

1. Reads the pending file list from the session's obligation state file
2. If no pending file exists or the list is empty, returns `silent` (session proceeds)
3. Reads the current block count for this session
4. If the block limit (`MAX_BLOCKS`) has been reached, writes a review document and clears the flag files, releasing the session
5. Otherwise, builds a block message containing:
   - A narrative opener with escalating tone based on violation count
   - The list of modified files lacking documentation updates
   - Specific suggestions for which documentation to create or update
6. Increments the block count and returns a `block` decision

```typescript
// Core enforcer flow
const pending = deps.readPending(flagFile);
if (blockCount >= MAX_BLOCKS) {
  deps.writeReview(reviewPath, buildBlockLimitReview(pending, blockCount));
  deps.removeFlag(flagFile);
  return ok({ type: "silent" });
}
const reason = `${opener}\n\nModified files without documentation updates:\n${fileList}\n\n${suggestions}`;
return ok({ type: "block", decision: "block", reason });
```

## Examples

### Example 1: Code modified without docs

> You edit `src/parser.ts` during a session but do not update any documentation. When you try to end the session, DocObligationEnforcer blocks with a message listing the modified file and suggesting which documentation to update.

### Example 2: Block limit reached

> After being blocked once without writing docs, you attempt to end the session again. The enforcer reaches its block limit, writes a review document to `MEMORY/STATE/doc-obligation/review-{session_id}.md`, clears the pending flags, and releases the session.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `narrative-reader` | lib | Picks escalating narrative tone for block messages |
| `DocObligationStateMachine.shared` | shared | Provides `projectHasHook`, `pendingPath`, `blockCountPath`, `MAX_BLOCKS`, `buildBlockLimitReview`, `buildDocSuggestions` |
| `result` | core | `ok` wrapper for Result type returns |
