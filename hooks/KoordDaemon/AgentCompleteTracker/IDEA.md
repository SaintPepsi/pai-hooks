# Agent Complete Tracker

> Notify a coordination daemon when a background agent finishes its work.

## Problem

A coordination daemon tracks which agents are active. When an agent finishes, the daemon needs to know so it can update its state, report results, and potentially assign new work. Without an explicit completion signal, the daemon has no way to distinguish a finished agent from one that is still running.

## Solution

After a background agent tool completes, extract the agent's thread identifier from the tool output and POST a completion notification to the coordination daemon. Distinguish completion events from spawn events by checking whether the invocation was a background launch. Fail silently on all errors so agent completion is never blocked.

## How It Works

1. After an agent tool use, check if this was a background spawn (if so, skip -- spawns are tracked separately).
2. Extract the thread identifier from the tool output (not the input, to avoid false positives at spawn time).
3. If no thread identifier is found, exit silently (not a tracked agent).
4. Resolve the daemon URL from environment variables or configuration.
5. POST `{ thread_id }` to the daemon's completion endpoint with a short timeout.

## Signals

- **Input:** Agent tool completion events (non-background invocations with a thread ID in output)
- **Output:** HTTP POST to daemon `/complete` endpoint, or silent pass-through
