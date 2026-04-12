## Overview

WikiReadTracker is a PostToolUse hook that records every wiki page read as a metric. It fires on Read tool calls where the file path contains `MEMORY/WIKI/` and appends a JSON line to `.pipeline/metrics.jsonl`. The hook is designed for negligible latency — a single string check in `accepts()` and a file append in `execute()`.

## Event

PostToolUse

## When It Fires

- Tool call is **Read**
- The `file_path` in tool input contains `MEMORY/WIKI/`

Does **not** fire for Write, Edit, Bash, Glob, Grep, or any other tool calls. Does **not** fire for Read calls targeting paths outside the wiki directory.

## What It Does

1. Extracts the `file_path` from the Read tool input
2. Builds a metric record with `session_id`, `path`, and `timestamp` (ISO 8601)
3. Appends the record as a JSON line to `MEMORY/WIKI/.pipeline/metrics.jsonl`
4. Returns `{ continue: true }` with no additional context — this is a silent tracking hook

If the file append fails (e.g., disk full), the error is logged to stderr and the hook still returns `{ continue: true }` to avoid blocking the session.

## Examples

> A Read of `/Users/hogers/.claude/MEMORY/WIKI/entities/koord.md` appends: `{"session_id":"abc-123","path":"/Users/hogers/.claude/MEMORY/WIKI/entities/koord.md","timestamp":"2026-04-06T12:00:00.000Z"}`

> A Read of `/Users/hogers/.claude/MEMORY/LEARNING/signals.jsonl` does not fire — the path does not contain `MEMORY/WIKI/`.

## Dependencies

- `@hooks/core/adapters/fs` — `appendFile` for metric writes
- `@hooks/lib/paths` — `getPaiDir` for resolving the wiki directory path
- The `.pipeline/` directory under `MEMORY/WIKI/` is created automatically by `appendFile` if it does not exist
