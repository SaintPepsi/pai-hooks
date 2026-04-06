# Cron Delete

> Remove a scheduled task by ID.

## Problem

Users need to cancel scheduled tasks they no longer want. If a task is removed from the session's schedule without updating the state file, the fire and prune hooks will continue operating on stale data.

## Solution

When a task deletion is requested, find and remove the matching entry from the session's cron state file. If the deleted task was the last one, remove the entire state file to keep the directory clean. Log the deletion event.

## How It Works

1. Receive a deletion event with the target task's ID.
2. Read the session's cron state file -- if it does not exist, do nothing.
3. Find the task entry matching the given ID -- if not found, do nothing.
4. Remove the entry from the list.
5. If no tasks remain, delete the state file entirely; otherwise, write the updated file.
6. Append a "deleted" event to the daily log.

## Signals

- **Input:** Task deletion event with the task ID
- **Output:** Updated or removed session cron state file; "deleted" log entry
