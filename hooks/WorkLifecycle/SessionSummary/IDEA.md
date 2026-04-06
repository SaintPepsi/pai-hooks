# Session Summary

> Clean up session state and mark work as completed when a session ends.

## Problem

When a session ends, its work directory is left marked as "active" and its state file lingers on disk. Downstream systems that check for active work see stale entries. The terminal tab retains session-specific styling. Without cleanup, the system accumulates ghost state from finished sessions.

## Solution

At session end, find the session's state file, read the associated work directory, update its metadata from "active" to "completed" with a completion timestamp, delete the session state file, and reset the terminal tab to its default styling.

## How It Works

1. At session end, look up the session-scoped state file by session ID.
2. Read the state file to find the associated work directory path.
3. Update the work directory's metadata file: change status from "active" to "completed" and set the completion timestamp.
4. Delete the session state file so it no longer appears as active work.
5. Reset the terminal tab title and styling to defaults.

## Signals

- **Input:** Session end event with a session ID
- **Output:** Updated work directory metadata (status: completed), deleted state file, reset terminal tab
