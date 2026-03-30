# StartupGreeting

## Overview

StartupGreeting is a **SessionStart** hook that displays the PAI banner and system status when a new session begins. It runs the external `Banner.ts` tool to generate a formatted banner with system information.

The hook skips entirely for subagent sessions to avoid cluttering parallel agent output with banners.

## Event

`SessionStart` — fires when a new Claude Code session begins, displaying the PAI banner.

## When It Fires

- Every main session start (accepts always returns true)

It does **not** fire when:

- The session is a subagent (detected via `CLAUDE_PROJECT_DIR` containing `/.claude/Agents/` or `CLAUDE_AGENT_TYPE` being set)
- The banner script fails or produces no output (returns silent)

## What It Does

1. Checks if the session is a subagent; if so, returns `silent`
2. Runs `Banner.ts` via `bun` with the current terminal environment (`COLUMNS`)
3. If the banner script produces output, returns it as `ContextOutput`
4. If the banner script fails or returns empty, returns `silent`

```typescript
// Run banner script
const bannerOutput = deps.runBanner();
if (bannerOutput) {
  return ok({ type: "context", content: bannerOutput });
}
return ok({ type: "silent" });
```

## Examples

### Example 1: Normal startup with banner

> A new session starts. StartupGreeting runs Banner.ts which outputs a formatted ASCII banner with the PAI identity, current date, system stats, and active mode. The banner is injected into the session context.

### Example 2: Subagent session skipped

> A subagent is spawned for a parallel task. StartupGreeting detects the subagent environment and returns silent immediately. No banner is displayed.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `process` | adapter | Provides `spawnSyncSafe` for running the Banner.ts script |
| `fs` | adapter | Provides `readJson` for settings access |
| `result` | core | Provides `ok` and `Result` type for error handling |
| `Banner.ts` | external tool | Generates the formatted PAI startup banner |
