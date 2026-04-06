# Git Auto Sync

> Automatically commit and push a directory on session end to prevent work loss.

## Problem

Work done during an interactive session — configuration changes, notes, state files — can be lost if the session ends without committing. This is especially common with AI-assisted workflows where changes accumulate across many files over the course of a session. Manual "remember to commit" discipline doesn't scale when sessions end unpredictably.

## Solution

Automatically stage, commit, and push all changes in a monitored directory when a session ends. Include debouncing to avoid excessive commits, lock detection to prevent conflicts with concurrent sessions, key file backup before pulling to catch unexpected remote changes, and stale file cleanup.

## How It Works

1. When a session ends, check for uncommitted changes in the monitored directory.
2. If another session is actively using git (lock file exists), skip to avoid conflicts.
3. If the last auto-sync was recent (within a debounce window), skip.
4. Stage all changes and create a timestamped commit.
5. Back up critical files before pulling from the remote.
6. Pull with merge (never rebase) to integrate remote changes.
7. Verify no critical files changed unexpectedly during the merge.
8. Push to the remote in the background so session exit isn't delayed.
9. Clean up stale tracking files from dead processes.

## Signals

- **Input:** Session end event
- **Output:** Silent (never blocks session end, all work is best-effort)

## Context

This pattern is designed for directories that contain configuration and state rather than application code. The "backup before pull, verify after merge" strategy protects against remote changes overwriting critical local files.
