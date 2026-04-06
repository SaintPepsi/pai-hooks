# Bash Write Guard

> Prevent shell commands from bypassing file editing safety checks.

## Problem

When a system enforces coding standards by intercepting file edit operations, there's a backdoor: writing files via shell commands (redirects, sed, tee, cp) instead of the monitored editing tools. AI assistants are especially prone to this — if an edit gets blocked, they may instinctively switch to a shell command to accomplish the same write, completely sidestepping enforcement.

## Solution

Monitor shell command execution and detect when a command would write to a code file. If a shell command contains a write pattern targeting a monitored file type, block it and direct the author to use the monitored editing tools instead.

## How It Works

1. When a shell command is about to execute, check if it references any monitored file types.
2. Scan the command for write patterns: output redirection, in-place editing, tee, copy, or move operations.
3. If a write pattern targets a monitored file, block the command and explain that the editing tools must be used instead.
4. Allow shell commands that only read or inspect monitored files.

## Signals

- **Input:** Shell command string about to be executed
- **Output:** Block (with explanation to use the editing tools instead) or pass
