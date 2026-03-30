# CanaryHook

## Overview

CanaryHook is a **SessionStart** hook used to verify that the hook propagation pipeline is working. On every session start, it appends a timestamp to a canary log file and opens it in VS Code. If the log file gets entries, hooks are firing. If it doesn't, something is broken in the pipeline.

This is a debug/diagnostic hook, not a production enforcement hook.

## Event

`SessionStart` — fires once at the beginning of every Claude Code session.

## When It Fires

- Every session start, unconditionally (`accepts()` always returns `true`)

## What It Does

1. Ensures the log directory exists at `~/.claude/MEMORY/STATE/logs/`
2. Appends the current ISO timestamp to `canary-hook.log`
3. Opens the log file in VS Code via `code` command

```typescript
deps.ensureDir(logDir);
deps.appendFile(logFile, `${new Date().toISOString()}\n`);
deps.execSyncSafe(`code "${logFile}"`);
```

## Examples

### Example 1: Verifying hook propagation

> A new session starts. CanaryHook appends `2026-03-30T08:30:00.000Z` to the canary log. VS Code opens the file. The developer sees the timestamp, confirming hooks are firing correctly.

### Example 2: Diagnosing broken hooks

> After changing hook configuration, the developer starts a new session. The canary log has no new entry. This confirms hooks are not propagating, and the issue is in the hook runner or settings, not in individual hook logic.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `core/adapters/fs` | adapter | `appendFile`, `ensureDir` for log file operations |
| `core/adapters/process` | adapter | `execSyncSafe` to open the log in VS Code |
