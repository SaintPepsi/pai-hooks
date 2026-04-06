# Cron Create

> Register a new scheduled task with its cron expression and prompt.

## Problem

A session needs a way to register recurring tasks so they can be tracked, fired, and eventually cleaned up. Without a creation step that persists the task definition, there is nothing for the execution and cleanup hooks to operate on.

## Solution

When a scheduled task is created, extract its ID, name, schedule, and prompt from the creation event. Append it to the session's cron state file (creating the file if this is the first task). Log the creation event for auditing.

## How It Works

1. Extract the task ID, human-readable name, cron schedule, recurrence flag, and prompt from the creation event.
2. Read the session's existing cron state file, or initialize a new one if none exists.
3. Append the new task entry with a fire count of zero and no last-fired time.
4. Write the updated state file.
5. Append a "created" event to the daily log.

## Signals

- **Input:** Task creation event with schedule, prompt, and metadata
- **Output:** Updated session cron state file; "created" log entry
