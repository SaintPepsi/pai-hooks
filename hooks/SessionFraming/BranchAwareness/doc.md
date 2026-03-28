# BranchAwareness

## Overview

BranchAwareness is a **SessionStart** hook that injects the current git branch name into the session context. It runs `git branch --show-current` once at session start and provides the result as a context injection, giving the agent immediate awareness of which branch it is working on without ongoing context cost.

The hook skips for subagent sessions and fails silently if the git command fails (e.g., when not in a git repository).

## Event

`SessionStart` — fires when a new Claude Code session begins, injecting the current git branch as context.

## When It Fires

- Every main session start (accepts always returns true)
- The current directory is a git repository with a checked-out branch

It does **not** fire when:

- The session is a subagent (detected via `CLAUDE_PROJECT_DIR` containing `/.claude/Agents/` or `CLAUDE_AGENT_TYPE` being set)
- The `git branch --show-current` command fails (e.g., not a git repo, detached HEAD)

## What It Does

1. Checks if the session is a subagent; if so, returns `silent`
2. Runs `git branch --show-current` via `execSyncSafe`
3. If the command fails or returns empty, logs a warning and returns `silent`
4. If a branch name is found, logs it to stderr and returns a `ContextOutput` with the branch name

```typescript
const branch = deps.getBranch();

if (!branch) {
  deps.stderr("[BranchAwareness] Could not determine git branch — skipping");
  return ok({ type: "silent" });
}

deps.stderr(`[BranchAwareness] Current branch: ${branch}`);
return ok({ type: "context", content: `Current git branch: \`${branch}\`` });
```

## Examples

### Example 1: Feature branch detected

> A session starts while working in the `feat/add-voice-gate` branch. BranchAwareness runs `git branch --show-current`, gets "feat/add-voice-gate", and injects `Current git branch: \`feat/add-voice-gate\`` into the session context. The agent now knows which branch it is on.

### Example 2: Not a git repository

> A session starts in a directory that is not a git repository. The `git branch --show-current` command fails. BranchAwareness logs "[BranchAwareness] Could not determine git branch -- skipping" and returns silent. No branch context is injected.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `process` | adapter | Provides `execSyncSafe` for running `git branch --show-current` |
| `result` | core | Provides `ok` and `Result` type for error handling |
