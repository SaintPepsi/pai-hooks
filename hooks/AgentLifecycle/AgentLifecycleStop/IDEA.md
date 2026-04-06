# Agent Lifecycle Stop

> Record when a sub-agent finishes and clean up orphans from crashed agents.

## Problem

When a sub-agent finishes, the system needs to record its completion for auditing and resource tracking. Agents that crash or disconnect never report completion, leaving behind stale state files that falsely indicate active agents.

## Solution

When a sub-agent stops, update its state file with a completion timestamp. If the state file is missing or corrupt (indicating a crash), create a recovery record. After recording the stop, scan all agent state files and remove any that have been running without completion for longer than a threshold (30 minutes), treating them as orphans from crashed agents.

## How It Works

1. A sub-agent stop event fires with the agent's session ID.
2. Read the agent's existing state file to get its start time.
3. If the file is missing or corrupt, create a crash-recovery record with the current time as both start and end.
4. Write the updated state file with the completion timestamp.
5. Scan all agent state files and delete any without a completion time whose start time is more than 30 minutes ago.

## Signals

- **Input:** Sub-agent stop event with session ID
- **Output:** Updated agent state file with completion time; removal of orphaned agent state files
