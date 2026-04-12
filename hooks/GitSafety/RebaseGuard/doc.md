## Overview

Blocks git rebase operations with a retry-to-confirm pattern. First attempt blocks with guidance to use `git merge` instead. If the exact same command is retried in the same session, it is allowed through. Rebase rewrites commit history, making branches incompatible with their remote and requiring force-push.

## Event

PreToolUse (fires before Bash commands execute)

## When It Fires

- Any Bash tool call containing a git command

## What It Does

1. Extracts the command string from Bash tool input
2. Splits chained commands (&&, ||, ;, |) into segments and truncates at heredoc markers to avoid false positives on commit messages or heredoc bodies
3. Checks each segment for rebase operations:
   - `git rebase` (direct rebase, including --onto, -i, --continue, --abort)
   - `git pull --rebase` or `git pull --rebase=interactive`
   - `git pull -r`
4. If rebase detected on first attempt: blocks with a message recommending `git merge` and records the command in session state
5. If the same command is retried: allows through and clears the state (so a third attempt would block again)
6. If not rebase: continues without interference

## Examples

> **Blocked (1st attempt):** `git rebase main` — Direct rebase, blocks with retry guidance
> **Allowed (2nd attempt):** `git rebase main` — Same command retried, allowed through
> **Blocked:** `git pull --rebase origin main` — Pull with rebase flag
> **Blocked:** `git pull -r origin main` — Pull with short rebase flag
> **Allowed:** `git pull origin main` — Normal pull (merge)
> **Allowed:** `git pull --no-rebase origin main` — Explicit no-rebase pull
> **Allowed:** `git merge origin/main` — Merge (the correct alternative)
> **Allowed:** `git commit -m "block git rebase"` — Rebase in commit message, not a command

## Dependencies

- `@hooks/core/contract` — SyncHookContract type (2-param `<I, D>` post-SDK-refactor)
- `@hooks/core/adapters/fs` — readFile, writeFile, ensureDir, removeFile for session state
- `@hooks/core/result` — Result type and ok() constructor
- `@hooks/core/types/hook-inputs` — ToolHookInput type
- `@anthropic-ai/claude-agent-sdk` — `SyncHookJSONOutput` return type; PreToolUse block via `hookSpecificOutput.permissionDecision: "deny"` (R4 shape, post-SDK-refactor 1D migration)
