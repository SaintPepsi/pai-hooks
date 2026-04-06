# Worktree Safety Verification

> Run safety checks after creating a git worktree to prevent cross-contamination and ensure readiness.

## Problem

Git worktrees provide isolated working directories, but they require setup that's easy to forget: the worktree directory needs to be gitignored (or it gets committed as part of the parent repo), dependencies need to be installed fresh (they're not shared from the main checkout), and baseline tests should run to confirm the starting state is clean. Skipping any of these steps leads to subtle bugs, accidental commits of worktree contents, or hours of debugging "tests that pass on main but fail here."

## Solution

Automatically run a safety checklist after a worktree is created: verify the directory is gitignored (and add it if not), install dependencies in the background using the detected package manager, and run baseline tests in the background to establish a known-good starting state.

## How It Works

1. After a worktree is created, extract the worktree path from the creation response.
2. Find the parent repository's git root and check if the worktree directory is in .gitignore.
3. If not gitignored, add an entry and commit the change automatically.
4. Detect the project's package manager by checking for lock files and manifests.
5. Run dependency installation in the background so it doesn't block the author.
6. Detect the project's test runner and run baseline tests in the background.

## Signals

- **Input:** Worktree creation event with the new worktree's path
- **Output:** Advisory context (never blocks worktree creation, all checks are best-effort)

## Context

This pattern prevents a class of issues where worktrees appear ready but have subtle environment differences from the main checkout. The background execution model means the author can start working immediately without waiting for installs or test runs.
