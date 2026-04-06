# Branch Awareness

> Inject the current git branch name into every session so the AI knows where it is working.

## Problem

AI coding assistants operate on files but often do not know which git branch they are on. This leads to commits on the wrong branch, pull requests targeting the wrong base, and confusion when the user references branch-specific work. The assistant should know the branch from the start, without the user having to mention it.

## Solution

At session start, run a single git command to detect the current branch and inject it into the session context. This is a one-time, zero-cost operation — no ongoing overhead, no polling. If the command fails (not a git repo, detached HEAD), skip silently.

## How It Works

1. At session start, run `git branch --show-current` to get the active branch name.
2. If the command succeeds, inject the branch name into the session context as a single line.
3. If the command fails or returns empty (detached HEAD, not a git repo), skip silently.
4. Skip entirely for sub-agent sessions to avoid redundant context.

## Signals

- **Input:** Git repository state in the current working directory
- **Output:** A single context line with the current branch name, or nothing if unavailable
