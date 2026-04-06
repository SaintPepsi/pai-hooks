# Cron Status Line

> Manage scheduled recurring tasks with creation, execution tracking, pruning, and session cleanup.

## Problem

Long-running AI sessions need to execute tasks on a schedule -- checking statuses, running maintenance, polling external systems. Without a cron-like mechanism, users must manually trigger recurring work or rely on external schedulers that have no awareness of session state. When sessions end or crash, scheduled tasks should not persist as zombies.

## Solution

Provide a complete lifecycle for scheduled tasks within a session: create them with a cron expression and prompt, detect when they fire, track execution counts, and clean them up when the session ends or when orphaned files are detected from crashed sessions. Each session's cron state is stored in its own file, and all events are logged to a daily append-only log.

## How It Works

1. When a cron task is created, persist it to the session's state file with its schedule, prompt, and metadata.
2. When user input arrives, check if it matches a registered cron task's prompt -- if so, increment its fire count and record the time.
3. When a cron task is deleted, remove it from the session state file; if no tasks remain, delete the file entirely.
4. On session start, scan for orphaned cron files from dead sessions (based on file staleness) and remove them.
5. On session end, delete the current session's cron state file as a clean-exit path.
6. All lifecycle events (created, fired, deleted, pruned) are appended to a daily JSONL log for auditing.

## Signals

- **Input:** Task creation/deletion commands, user prompts (for fire detection), session start/end events
- **Output:** Per-session cron state files; daily event logs; automatic cleanup of orphaned state

## Context

This pattern is useful in any long-running interactive system that needs lightweight, session-scoped scheduled tasks without depending on an external cron daemon.
