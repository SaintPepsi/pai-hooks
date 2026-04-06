# Cron Fire

> Detect when a scheduled task fires by matching incoming prompts against registered cron tasks.

## Problem

Scheduled tasks are injected into the session as user prompts at their scheduled time, but the cron system needs to know when a task actually fires so it can track execution counts and timing. Without detection, there is no way to distinguish a cron-triggered prompt from a normal user message.

## Solution

On every incoming user prompt, check whether it matches any registered cron task's prompt string. If it matches, increment the task's fire count, record the fire time, and log the event. This runs on every prompt but exits early (no file writes) when there is no match.

## How It Works

1. Receive the user's prompt text.
2. If the prompt is empty, exit immediately.
3. Read the session's cron state file -- if it does not exist, exit.
4. Search for the first cron task whose prompt string appears in the incoming prompt.
5. If no match is found, exit without writing anything.
6. Increment the matched task's fire count and record the current time as last-fired.
7. Write the updated state file and append a "fired" event to the daily log.

## Signals

- **Input:** Every user prompt submission
- **Output:** Updated cron state file with incremented fire count (only when a match is found); "fired" log entry
