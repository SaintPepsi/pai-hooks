# Protected Branch Guard

> Prevent direct commits, pushes, and merges to protected branches.

## Problem

Direct commits to main or master bypass the pull request workflow — no code review, no CI checks, no audit trail. AI assistants are especially prone to this because they default to committing on whatever branch is current. A single accidental push to main can trigger production deployments, break other developers' work, or corrupt shared history.

## Solution

Intercept git mutation commands (commit, push, merge), check the current branch, and block if it's a protected branch. Support configurable exempt directories for repositories that legitimately commit to main (e.g., personal configuration repos with auto-sync).

## How It Works

1. When a shell command is about to execute, detect git mutation commands (commit, push, merge).
2. Check the current working directory against a list of exempt directories (both built-in and user-configured).
3. If the directory is exempt, allow the command.
4. Query the current git branch.
5. If the branch is protected (main or master), block the command and instruct the author to create a feature branch first.
6. If the branch can't be determined, fail open and allow the command.

## Signals

- **Input:** Shell command string about to be executed
- **Output:** Block (with instructions to create a feature branch) or pass
