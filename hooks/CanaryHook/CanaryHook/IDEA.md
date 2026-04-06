# Canary Hook

> Inject a verifiable timestamp at session start to prove the context-loading pipeline executed.

## Problem

When a system loads context at startup through a pipeline of hooks and configuration files, a silent failure anywhere in that pipeline means the session runs without expected context. There is no built-in way to verify that the pipeline actually ran.

## Solution

Place a minimal hook at the start of the pipeline that writes a timestamp to a known log file. If the timestamp is present, the pipeline executed. If it is absent, the pipeline failed. The hook does nothing else -- its only purpose is to be verifiable.

## How It Works

1. On session start, ensure the log directory exists.
2. Append the current ISO timestamp to a canary log file.
3. Return a continue signal so the session proceeds without interruption.

## Signals

- **Input:** Session start event
- **Output:** A timestamped line appended to a canary log file
