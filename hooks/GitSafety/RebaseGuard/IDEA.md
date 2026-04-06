# Rebase Guard

> Block all rebase operations to prevent history rewriting.

## Problem

Rebase rewrites commit history, making the local branch incompatible with the remote. This forces a force-push, which overwrites remote history and can destroy other contributors' work. AI assistants frequently suggest or attempt rebases as a "clean" way to integrate changes, not understanding the downstream consequences in shared repositories.

## Solution

Unconditionally block all rebase operations — both explicit rebases and pull-with-rebase — and direct the author to use merge instead. No exceptions, no configuration. Merge preserves history and never requires force-push.

## How It Works

1. When a shell command is about to execute, split it into individual command segments (handling chains and pipes).
2. Check each segment for rebase patterns: direct rebase commands and pull commands with rebase flags.
3. Correctly handle negation flags (e.g., pull with an explicit no-rebase flag is allowed).
4. If any segment is a rebase operation, block the entire command and suggest the merge alternative.

## Signals

- **Input:** Shell command string about to be executed
- **Output:** Block (with merge alternative) or pass
