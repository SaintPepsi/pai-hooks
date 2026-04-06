# Permission Prompt Logger

> Log every permission prompt to build a dataset for reducing user friction.

## Problem

Interactive AI tools frequently pause to ask users for permission before executing commands or accessing files. Over time, these prompts become friction — but without data on which prompts fire, how often, and for which tools, there is no way to systematically reduce them. The permission system is a black box.

## Solution

Silently log every permission prompt the system generates, capturing the tool name, a summary of what it wanted to do, and the permission context. The log accumulates over time as a structured dataset that can be analyzed to identify the most frequent prompts, tune allowlists, and measure permission friction before and after changes.

## How It Works

1. Fire on every permission prompt event, for all tools — no filtering.
2. Extract a human-readable summary of the tool input (command text, file path, or truncated prompt).
3. Write a structured log entry (timestamp, session ID, tool name, input summary, permission mode) as a single JSON line to an append-only log file.
4. Return silently so the permission prompt proceeds normally — this hook is purely observational.

## Signals

- **Input:** Tool name, tool input, permission mode, and suggested actions from the permission system
- **Output:** Silent (no user-visible effect) — all output goes to the structured log file
