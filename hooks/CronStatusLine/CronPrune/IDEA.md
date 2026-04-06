# Cron Prune

> Remove orphaned cron state files left behind by sessions that crashed or exited uncleanly.

## Problem

When a session crashes or is killed, its cron state file remains on disk. Over time, these orphaned files accumulate. Without cleanup, any reporting or status checks see ghost tasks from dead sessions.

## Solution

On every session start, scan the cron state directory for files that have not been modified recently. A live session heartbeats its cron file on every fire, so a stale modification time means the owning session is dead. Compute a dynamic staleness threshold based on the longest cron interval in the file (2x the interval), then delete files that exceed it.

## How It Works

1. On session start, check if the cron state directory exists -- if not, do nothing.
2. List all JSON files in the directory.
3. For each file, read its modification time and its cron entries.
4. Compute a prune threshold: twice the longest cron schedule interval, or a default of 5 minutes if no schedules are parseable.
5. If the file's age exceeds the threshold, delete it and log a "pruned" event.

## Signals

- **Input:** Session start event
- **Output:** Deletion of stale cron state files; "pruned" log entries for each removed file
