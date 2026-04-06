# Session ID Register

> Register an agent session's unique ID with the coordination daemon at startup.

## Problem

When a coordination daemon spawns an agent, it knows the agent's thread ID but not the session ID that the agent runtime assigns. The daemon needs the session ID to route messages and track which runtime session belongs to which coordinated thread. Without registration, the daemon cannot address the agent.

## Solution

At session start, read the thread ID from an environment variable (set by the daemon when it spawned the agent) and POST both the thread ID and the new session ID to the daemon's registration endpoint. This maps the daemon's thread identifier to the runtime's session identifier, enabling message routing from the first message onward.

## How It Works

1. On session start, extract the session ID from the runtime input.
2. Read the thread ID from an environment variable set by the coordination daemon.
3. If either is missing, exit silently (this session was not spawned by a daemon).
4. Resolve the daemon URL from environment variables or configuration.
5. POST `{ sessionId, threadId }` to the daemon's registration endpoint.

## Signals

- **Input:** Session start event with a session ID and a daemon-set thread ID environment variable
- **Output:** HTTP POST to daemon `/register-session` endpoint, or silent pass-through
