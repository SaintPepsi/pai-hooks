# SpotCheckReview

## Overview

SpotCheckReview is a **Stop-event** hook that blocks session end to request a spot-check code review of unpushed changes. It compares file hashes against previously reviewed hashes to avoid re-reviewing files that have already been checked, and uses a block limit to avoid blocking indefinitely.

The hook delegates the actual review to a Sonnet agent, asking it to check for bugs, security issues, missing error handling, code quality, and adherence to project conventions.

## Event

`Stop` — fires when the user attempts to end a Claude Code session, blocking if there are unreviewed unpushed changes that need a spot-check review.

## When It Fires

- There are unpushed git changes (files differing from upstream)
- At least one changed file has not been reviewed (hash differs from previously reviewed hash)
- The block count has not yet reached `MAX_BLOCKS` (default: 1)

It does **not** fire when:

- The current working directory is the PAI hooks directory itself
- There are no unpushed changes (`git diff @{upstream}...HEAD` returns nothing)
- All changed files have already been reviewed (hashes match)
- The block limit has been reached (files are marked as reviewed and session is released)
- A project-level `SpotCheckReview` hook exists (checked via `projectHasHook`)

## What It Does

1. Checks if the current directory is the PAI directory; if so, returns `silent`
2. Gets the list of unpushed files via `git diff @{upstream}...HEAD`
3. If no files changed, returns `silent`
4. Reads the block count for this session
5. If the block limit is reached, computes file hashes, saves them as reviewed, and releases the session
6. Otherwise, compares current file hashes against previously reviewed hashes
7. Filters to only unreviewed files (new or changed since last review)
8. If all files are already reviewed, returns `silent`
9. Increments the block count and returns a `block` with a message requesting a Sonnet agent review

```typescript
// Filter to unreviewed files by hash comparison
const reviewed = deps.readReviewedHashes(hashPath);
const currentHashes = deps.getFileHashes(files);
const unreviewedFiles = files.filter((f) => {
  const currentHash = currentHashes.get(f);
  if (!currentHash) return true;
  return reviewed[f] !== currentHash;
});
if (unreviewedFiles.length === 0) return ok({}); // R8 — bare empty object, silent skip
// R5 — Stop is a NonHookSpecificEvent, so block decision/reason go at the top level
// (NOT nested under hookSpecificOutput as PreToolUse permissionDecision would be).
return ok({ decision: "block", reason: buildBlockMessage(unreviewedFiles) });
```

## Examples

### Example 1: Unpushed changes need review

> You complete work on a feature branch with 5 modified files that haven't been pushed yet. When you try to end the session, SpotCheckReview blocks and instructs Claude to run a Sonnet agent review on the changed files, checking for bugs, security issues, and code quality.

### Example 2: Review completed, session proceeds

> After the spot-check review runs, you attempt to end the session again. The block limit (1) is reached, so SpotCheckReview computes hashes for all changed files, saves them as reviewed, and releases the session.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `fs` | adapter | File read/write/exists/remove operations for state persistence |
| `process` | adapter | `execSyncSafe` for running git commands to find unpushed files |
| `DocObligationStateMachine.shared` | shared | Provides `projectHasHook` for deduplication with project-level hooks |
| `@anthropic-ai/claude-agent-sdk` | SDK types | `SyncHookJSONOutput` return type. R5 block path uses top-level `decision: "block"` + `reason` because Stop is a NonHookSpecificEvent and has no `hookSpecificOutput` wrapping (contrast with PreToolUse where deny goes through `hookSpecificOutput.permissionDecision`). R8 silent path is a bare `{}`. Post-SDK-refactor migration. |
