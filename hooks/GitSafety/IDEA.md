# Git Safety

> Prevent destructive or unauthorized git and filesystem operations before they execute.

## Problem

AI assistants and automation scripts can execute git commands and file operations with the same authority as the user. A single careless command — force-pushing to main, deleting a directory tree, rebasing shared history, merging without review — can destroy work that's difficult or impossible to recover. The damage happens instantly and silently; there's no confirmation dialog.

## Solution

A suite of guards that intercept commands before execution and check them against safety rules. Each guard targets a specific class of dangerous operation: direct commits to protected branches, merges without CI or review, rebases that rewrite history, recursive deletes, and more. Dangerous operations are blocked with clear explanations. Recoverable-artifact cleanup gets a confirmation prompt instead of a hard block.

## How It Works

1. When a shell command is about to execute, each active guard checks whether it matches a dangerous pattern.
2. Guards that need external state (CI status, current branch, review status) query it in real time.
3. If the operation is dangerous and unrecoverable, block it with an explanation and safe alternative.
4. If the operation is dangerous but targets regenerable artifacts, prompt for confirmation.
5. Some guards also scan code being written for embedded dangerous patterns (e.g., recursive delete calls in source code).
6. On session end, a sync guard automatically commits and pushes to prevent work loss.

## Signals

- **Input:** Shell commands, file write content, and session lifecycle events
- **Output:** Block (with explanation and safe alternative), ask (confirmation for artifact cleanup), advisory (verification reminders), or silent (background sync)
