# CheckVersion

## Overview

CheckVersion is an **async SessionStart** hook that compares the installed Claude Code version against the latest version published on npm. If an update is available, it logs a notification to stderr. The check runs both version lookups in parallel for speed.

The hook is purely informational. It never blocks, never injects context, and always returns `silent`. It skips entirely for subagent sessions.

## Event

`SessionStart` — fires when a new Claude Code session begins, checking whether a newer version of Claude Code is available.

## When It Fires

- Every main session start (accepts always returns true)
- Both version lookups run concurrently via `Promise.all`

It does **not** fire when:

- The session is a subagent (detected via `CLAUDE_PROJECT_DIR` containing `/.claude/Agents/` or `CLAUDE_AGENT_TYPE` being set)
- Either version lookup fails (returns silent without logging)

## What It Does

1. Checks if the session is a subagent; if so, returns `silent`
2. Runs two version lookups in parallel:
   - `claude --version` to get the installed version (5-second timeout)
   - `npm view @anthropic-ai/claude-code version` to get the latest published version (10-second timeout)
3. If either lookup fails, returns `silent` without notification
4. If both versions are known and they differ, logs an update notification to stderr
5. Always returns `silent` output (never injects context)

```typescript
const [currentResult, latestResult] = await Promise.all([
  deps.getCurrentVersion(),
  deps.getLatestVersion(),
]);

if (currentVersion !== "unknown" && latestVersion !== "unknown" &&
    currentVersion !== latestVersion) {
  deps.stderr(`Update available: CC ${currentVersion} -> ${latestVersion}`);
}

return ok({ type: "silent" });
```

## Examples

### Example 1: Update available

> A session starts with Claude Code 1.0.30 installed. CheckVersion queries npm and finds 1.0.32 is the latest. It logs "Update available: CC 1.0.30 -> 1.0.32" to stderr. The user sees the notification in their terminal.

### Example 2: Already up to date

> A session starts with Claude Code 1.0.32 installed, which matches the npm latest. CheckVersion detects no difference and returns silent without logging anything.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `process` | adapter | Provides `exec` for running `claude --version` and `npm view` commands |
| `result` | core | Provides `ok` and `Result` type for error handling |
