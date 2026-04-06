# Agent Execution Guard

> Prevent slow sub-agents from blocking the user interface by enforcing background execution.

## Problem

In multi-agent systems, spawning a heavy sub-agent in the foreground locks the user interface until it finishes. Users cannot interact with the system while they wait. Developers forget to set the background flag, especially when the agent type or model is not obviously slow.

## Solution

Intercept every sub-agent spawn request and classify it as fast or slow. Fast agents (lightweight models, quick task types, or explicitly marked) are allowed to run in the foreground. Slow agents that are not configured to run in the background trigger a warning with instructions on how to fix it.

## How It Works

1. Intercept a sub-agent spawn request before execution begins.
2. Check if the agent is already set to run in the background -- if so, allow it.
3. Check if the agent type is in the fast-tier allowlist (e.g., exploration tasks) -- if so, allow it.
4. Check if the agent uses a lightweight model (e.g., a small/fast LLM) -- if so, allow it.
5. Check if the agent's task description explicitly declares fast timing -- if so, allow it.
6. If none of the above, inject a warning into the conversation advising the caller to run the agent in the background.

## Signals

- **Input:** Sub-agent spawn request with agent type, model, and background flag
- **Output:** Pass (allow spawn) or warning (advising background execution)
