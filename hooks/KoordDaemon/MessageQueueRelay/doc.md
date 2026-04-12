# MessageQueueRelay

## Overview

MessageQueueRelay is a **sync PostToolUse** hook that detects when the `mq-watcher` Bash script exits and relays the queued message to the agent. It creates a persistent message loop: the agent runs the watcher, the watcher blocks until a message arrives, the watcher exits with the message as stdout, and this hook injects the message content along with a directive to respawn the watcher.

This hook works in tandem with MessageQueueServer, which spawns the HTTP server that receives messages from the Koord daemon. Together they form a continuous realtime communication channel.

## Event

`PostToolUse` — fires after a Bash command completes, checking if it was the mq-watcher script and relaying any received message back to the agent.

## When It Fires

- The `tool_name` is `"Bash"`
- The Bash command contains the `mq-watcher` marker string
- The watcher output contains a message (non-empty stdout) or timed out (empty stdout)

It does **not** fire when:

- The tool is not the Bash tool
- The Bash command does not contain the `mq-watcher` marker
- The tool is any other Bash command

## What It Does

1. Checks `accepts()`: only proceeds for `tool_name === "Bash"`
2. Tests if the Bash command contains the `MQ_WATCHER_MARKER` string
3. If the watcher output is empty (timeout), returns `ok({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "..." } })` with a respawn directive
4. If the watcher output contains a message, parses it as JSON (falling back to raw text)
5. Extracts the session ID from the `--session` argument in the command
6. Builds a message relay containing the message body and a respawn command
7. Returns `ok({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "..." } })` instructing the agent to process the message and respawn the watcher

```typescript
// Parse the message from watcher stdout
const message = parseWatcherOutput(responseText);

return ok({
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: [
      "## Message Queue: New Message Received",
      `**Message${from}:**`,
      message.body,
      "**IMPORTANT: After processing this message, immediately respawn the watcher:**",
      respawnCmd,
    ].join("\n"),
  },
});
```

## Examples

### Example 1: Message received from daemon

> The mq-watcher script receives a JSON message `{ "from": "coordinator", "body": "Please review PR #42" }` and exits. MessageQueueRelay parses the output, injects the message as context with "Message from coordinator: Please review PR #42", and tells the agent to respawn the watcher with `bun scripts/mq-watcher.ts --session {session_id}`.

### Example 2: Watcher timeout (no message)

> The mq-watcher script times out with no messages received and exits with empty output. MessageQueueRelay detects the empty response and returns a respawn directive so the agent restarts the watcher to continue listening.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `result` | core | `ok()` for Result wrapping |
| `KoordDaemon/shared` | shared | `MQ_WATCHER_MARKER` constant for command detection |
