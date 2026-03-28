# StartupGreeting

## Overview

StartupGreeting is a **SessionStart** hook that displays the PAI banner and system status when a new session begins. It runs the external `Banner.ts` tool to generate a formatted banner with system information, and persists Kitty terminal session environment variables so that later hooks can manage tab state.

The hook skips entirely for subagent sessions to avoid cluttering parallel agent output with banners.

## Event

`SessionStart` — fires when a new Claude Code session begins, displaying the PAI banner and persisting terminal environment.

## When It Fires

- Every main session start (accepts always returns true)
- Kitty environment persistence runs when `KITTY_LISTEN_ON` and `KITTY_WINDOW_ID` are set

It does **not** fire when:

- The session is a subagent (detected via `CLAUDE_PROJECT_DIR` containing `/.claude/Agents/` or `CLAUDE_AGENT_TYPE` being set)
- The banner script fails or produces no output (returns silent)

## What It Does

1. Checks if the session is a subagent; if so, returns `silent`
2. Checks for Kitty terminal environment variables (`KITTY_LISTEN_ON`, `KITTY_WINDOW_ID`)
3. If Kitty variables are present, persists them via `persistKittySession` (per session ID) or writes to `MEMORY/STATE/kitty-env.json` (fallback)
4. Runs `Banner.ts` via `bun` with the current terminal environment (`COLUMNS`, `KITTY_WINDOW_ID`)
5. If the banner script produces output, returns it as `ContextOutput`
6. If the banner script fails or returns empty, returns `silent`

```typescript
// Persist Kitty environment for later hooks
if (kittyListenOn && kittyWindowId) {
  deps.persistKittySession(input.session_id, kittyListenOn, kittyWindowId);
}

// Run banner script
const bannerOutput = deps.runBanner();
if (bannerOutput) {
  return ok({ type: "context", content: bannerOutput });
}
return ok({ type: "silent" });
```

## Examples

### Example 1: Normal startup with banner

> A new session starts in a Kitty terminal. StartupGreeting persists the Kitty session environment, then runs Banner.ts which outputs a formatted ASCII banner with the PAI identity, current date, system stats, and active mode. The banner is injected into the session context.

### Example 2: Subagent session skipped

> A subagent is spawned for a parallel task. StartupGreeting detects the subagent environment and returns silent immediately. No banner is displayed and no Kitty environment is persisted.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `tab-setter` | lib | Provides `persistKittySession` for saving Kitty terminal environment |
| `fs` | adapter | Provides `fileExists`, `ensureDir`, `writeFile` for environment persistence |
| `process` | adapter | Provides `spawnSyncSafe` for running the Banner.ts script |
| `result` | core | Provides `ok` and `Result` type for error handling |
| `Banner.ts` | external tool | Generates the formatted PAI startup banner |
