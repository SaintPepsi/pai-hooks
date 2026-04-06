# Activity Counter

> Maintain running totals of system activity across sessions.

## Problem

In a system with many automated hooks and processing steps, there is no centralized count of how much work has been done — how many hooks fired, how many files were processed, how many signals were produced. Without these numbers, you cannot gauge system health or growth over time.

## Solution

At the end of each session, spawn a background process that tallies activity metrics (hooks executed, files touched, signals generated) and writes the updated totals to a persistent state file. Running in the background ensures the session exit is not delayed.

## How It Works

1. When a session ends, launch a background counting process that will outlive the session.
2. The process scans activity logs and aggregates counts.
3. Updated totals are written to a persistent JSON state file.
4. The next session can read this file to display cumulative statistics.

## Signals

- **Input:** Session end event
- **Output:** Updated counts in a persistent state file (runs silently in the background)
