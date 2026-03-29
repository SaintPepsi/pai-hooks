## Overview

Unconditionally blocks all git rebase operations. Rebase rewrites commit history, making branches incompatible with their remote and requiring force-push. Use `git merge` instead.

## Event

PreToolUse (fires before Bash commands execute)

## When It Fires

- Any Bash tool call containing a git command

## What It Does

1. Extracts the command string from Bash tool input
2. Checks if the command is a rebase operation:
   - `git rebase` (direct rebase, including --onto, -i, --continue, --abort)
   - `git pull --rebase` or `git pull --rebase=interactive`
   - `git pull -r`
3. If rebase detected: blocks with a message explaining why and recommending `git merge`
4. If not rebase: continues without interference

## Examples

> **Blocked:** `git rebase main` — Direct rebase onto main branch
> **Blocked:** `git pull --rebase origin main` — Pull with rebase flag
> **Blocked:** `git pull -r origin main` — Pull with short rebase flag
> **Allowed:** `git pull origin main` — Normal pull (merge)
> **Allowed:** `git pull --no-rebase origin main` — Explicit no-rebase pull
> **Allowed:** `git merge origin/main` — Merge (the correct alternative)

## Dependencies

- `@hooks/core/contract` — SyncHookContract type
- `@hooks/core/result` — Result type and ok() constructor
- `@hooks/core/types/hook-inputs` — ToolHookInput type
- `@hooks/core/types/hook-outputs` — block() and continueOk() constructors
