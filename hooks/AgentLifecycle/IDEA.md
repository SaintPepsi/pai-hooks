# Agent Lifecycle

> Track and control sub-agent spawning, execution, and completion in multi-agent systems.

## Problem

Multi-agent systems spawn sub-agents dynamically, but without oversight the parent has no visibility into which agents are running, how long they have been active, or whether they completed successfully. Agents that crash or hang become orphans, silently consuming resources. Additionally, slow agents running in the foreground block the user interface unnecessarily.

## Solution

Intercept agent lifecycle events at three points: before an agent spawns (to enforce execution policy), when it starts (to record it), and when it stops (to record outcome and clean up). Maintain a per-agent state file so any part of the system can query what is currently running. Periodically garbage-collect orphaned agents that never reported completion.

## How It Works

1. Before a sub-agent spawns, check whether it qualifies as "fast" (lightweight model, quick task type, or explicitly marked fast).
2. If the agent is not fast and is not set to run in the background, warn the caller to run it in the background to avoid blocking.
3. When a sub-agent starts, create a state file recording its ID and start time.
4. When a sub-agent stops, update its state file with completion time and outcome.
5. On each stop event, scan for orphaned agents (started more than 30 minutes ago with no completion) and remove their state files.

## Signals

- **Input:** Agent spawn requests, agent start events, agent stop events
- **Output:** Warnings to run slow agents in background; per-agent state files for lifecycle tracking; orphan cleanup

## Context

This pattern is essential in systems where a primary agent delegates work to multiple sub-agents concurrently. Without lifecycle tracking, debugging agent failures or resource leaks becomes guesswork.
