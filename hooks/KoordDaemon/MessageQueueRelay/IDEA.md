# Message Queue Relay

> Relay incoming messages from a queue watcher into the agent's context and keep the listening loop alive.

## Problem

Agents need to receive real-time messages from a coordinator or other agents. A watcher process blocks until a message arrives, then exits with the message content. But the agent needs to actually process that message and immediately resume listening. Without a relay mechanism, the message is lost as raw command output with no processing directive.

## Solution

Detect when a queue watcher process exits (meaning a message arrived or it timed out). Parse the message from the watcher's output, inject it as structured context into the agent, and include a directive to respawn the watcher. This creates a persistent loop: watcher blocks, message arrives, watcher exits, relay injects message, agent processes it and restarts the watcher.

## How It Works

1. After a shell command completes, check if it was the message queue watcher script.
2. If the watcher exited with no output (timeout), inject a respawn directive so listening resumes.
3. If the watcher exited with message content, parse it (JSON with sender and body, or raw text as fallback).
4. Inject the parsed message as structured context along with a directive to respawn the watcher after processing.
5. The agent processes the message and runs the watcher again, creating a continuous listening loop.

## Signals

- **Input:** Shell command completions where the command was a message queue watcher
- **Output:** Injected message context with respawn instructions, or silent pass-through for non-watcher commands
