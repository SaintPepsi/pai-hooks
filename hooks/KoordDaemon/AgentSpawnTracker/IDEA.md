# Agent Spawn Tracker

> Notify a coordination daemon when a new background agent is launched.

## Problem

A coordination daemon needs to know the moment a new agent is spawned so it can track active workers, assign thread ownership, and maintain a live roster. Without spawn notifications, the daemon's view of active agents is incomplete and it cannot coordinate work distribution.

## Solution

After a background agent is launched, extract identifying information (agent name, thread ID, task description) from the invocation and POST it to the daemon's spawn endpoint. Require a valid thread identifier to avoid polluting tracking state with untracked agents. Fail silently on all errors so spawning is never blocked.

## How It Works

1. After an agent tool use, check if it was a background launch (skip foreground invocations).
2. Extract the thread identifier and validate it as a proper ID format.
3. If no valid thread ID exists, skip the notification to avoid polluting state.
4. Extract the agent name and task description from the invocation parameters.
5. Resolve the daemon URL from environment variables or configuration.
6. POST the spawn details (thread ID, agent name, task) to the daemon's spawn endpoint.

## Signals

- **Input:** Background agent launch events with a valid thread identifier
- **Output:** HTTP POST to daemon `/spawn` endpoint, or silent pass-through
