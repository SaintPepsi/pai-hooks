# Agent Coordination Daemon

> A hook layer that connects autonomous agents to a central coordination service for tracking, messaging, and context injection.

## Problem

When multiple AI agents work in parallel on different tasks, no single agent knows what the others are doing. Without coordination, agents duplicate work, miss messages from each other, and lack the context they need to collaborate. A central coordinator exists, but agents have no way to register themselves, report status, or receive instructions.

## Solution

Intercept agent lifecycle events (spawn, complete, session start) and relay them to a running coordination daemon via HTTP. Inject coordination context into agents before they start so every worker inherits the right instructions. Provide a message queue so agents can receive real-time messages from the coordinator or from each other.

## How It Works

1. When a session starts, register its unique ID with the coordination daemon so the daemon can address it.
2. When a background agent spawns, notify the daemon with the agent's identity, thread ID, and task description.
3. Before a background agent starts working, read a template and inject coordination instructions into its prompt.
4. When a background agent completes, notify the daemon so it can update tracking state.
5. On session start, launch a local HTTP server that accepts incoming messages for this session.
6. When a message arrives via the queue, relay it into the agent's context and instruct it to resume listening.

## Signals

- **Input:** Agent spawn/complete events, session start events, message queue watcher output
- **Output:** HTTP notifications to the daemon, injected context into agent prompts, message relay directives

## Context

Designed for multi-agent systems where a daemon orchestrates work across parallel agent sessions. All hooks fail silently so coordination issues never block the agents' primary work.
