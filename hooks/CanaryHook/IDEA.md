# Canary Hook

> Inject a canary token at session start to verify that the context-loading pipeline works correctly.

## Problem

Systems that load context at startup (configuration files, instructions, state) can fail silently. If the loading pipeline breaks, the session proceeds without the expected context, and the user may not realize something is wrong until they encounter unexpected behavior far into the session.

## Solution

Inject a known canary signal at the very start of every session. If the canary is present later, context loading succeeded. If it is absent, something in the loading pipeline failed. The canary doubles as a heartbeat log, recording a timestamp on each session start.

## How It Works

1. On session start, ensure the canary log directory exists.
2. Append the current timestamp to a canary log file.
3. Return a continue signal so the session proceeds normally.
4. Any later diagnostic check can verify the canary log to confirm the session started with context loaded.

## Signals

- **Input:** Session start event
- **Output:** A timestamped entry in a canary log file; session continues normally

## Context

This is the context-loading equivalent of a "ping" -- a minimal, zero-side-effect probe that confirms the machinery is connected and running. Useful in any system where silent startup failures are a risk.
