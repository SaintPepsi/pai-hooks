# Agent Lifecycle Start

> Record when a sub-agent begins execution for lifecycle tracking.

## Problem

When multiple sub-agents run concurrently, the parent system has no record of which agents are active unless it explicitly tracks them. Without a start record, there is no way to later determine how long an agent ran or whether it ever completed.

## Solution

When a sub-agent starts, immediately write a state file containing its ID and start timestamp. This file serves as a durable record that other parts of the system -- including the stop hook and orphan cleanup -- can read later.

## How It Works

1. A sub-agent start event fires with the agent's session ID.
2. Ensure the agent state directory exists.
3. Write a JSON file named after the agent's session ID, containing the ID, start time, and a null completion time.

## Signals

- **Input:** Sub-agent start event with session ID
- **Output:** A per-agent state file recording the start
