## Overview

Risk-aware rebase guard that responds in three tiers based on the command type and whether the current branch is published (has a remote upstream tracking ref). Safe in-progress controls are always allowed. Rebase on an unpublished branch emits a warning advisory but continues. Rebase on a published branch is blocked, since that branch's history is already shared and rewriting it would require a force-push.

## Event

PreToolUse (fires before Bash commands execute)

## When It Fires

- Any Bash tool call containing a git command

## What It Does

1. Calls `hasUpstream()` to determine if the current branch has a remote upstream tracking ref (`git rev-parse --abbrev-ref @{upstream}`). Fails open — if the check fails, treats the branch as unpublished.
2. Extracts the command string from the Bash tool input and splits it into individual segments (handling &&, ||, ;, | chains), truncating at heredoc markers to avoid false positives on commit messages.
3. Classifies each segment and resolves to the highest-risk tier across all segments:
   - `allow` — `git rebase --abort`, `git rebase --continue`, `git rebase --skip`, `git rebase --quit`, `git pull --rebase` (any variant)
   - `warn` — any other rebase on an unpublished branch
   - `block` — any other rebase on a published branch
4. On `allow` or no rebase detected: continues without interference.
5. On `warn`: continues but injects an advisory via `additionalContext` recommending `git merge`. Logs to stderr.
6. On `block`: denies the command with a message explaining the prohibition and suggesting `git merge` or `git pull --no-rebase`. Logs to stderr.

## Examples

> **Allowed:** `git rebase --abort` — Safe in-progress control, always allowed
> **Allowed:** `git rebase --continue` — Safe in-progress control, always allowed
> **Allowed:** `git rebase --skip` — Safe in-progress control, always allowed
> **Allowed:** `git rebase --quit` — Safe in-progress control, always allowed
> **Allowed:** `git pull --rebase origin main` — Pull-rebase is always allowed
> **Allowed:** `git pull -r origin main` — Short flag variant, always allowed
> **Advisory (unpublished branch):** `git rebase main` — Warns but continues; branch has no upstream
> **Advisory (unpublished branch):** `git rebase -i HEAD~3` — Interactive rebase on local-only branch
> **Blocked (published branch):** `git rebase main` — Branch has upstream; block with merge guidance
> **Blocked (published branch):** `git rebase -i HEAD~3` — Interactive rebase on shared branch
> **Allowed:** `git pull origin main` — Normal pull (merge), not a rebase
> **Allowed:** `git pull --no-rebase origin main` — Explicit no-rebase pull
> **Allowed:** `git merge origin/main` — Merge (the correct alternative)
> **Allowed:** `git commit -m "block git rebase"` — Rebase in commit message, not a command

## Dependencies

- `@hooks/core/contract` — `SyncHookContract` type
- `@hooks/core/adapters/process` — `execSyncSafe` for `hasUpstream` upstream check
- `@hooks/core/result` — `Result` type and `ok()` constructor
- `@hooks/core/types/hook-inputs` — `ToolHookInput` type
- `@anthropic-ai/claude-agent-sdk` — `SyncHookJSONOutput` return type; PreToolUse block via `hookSpecificOutput.permissionDecision: "deny"`; advisory via `hookSpecificOutput.additionalContext`
- `@hooks/lib/paths` — `defaultStderr`
- `@hooks/lib/tool-input` — `getCommand`
