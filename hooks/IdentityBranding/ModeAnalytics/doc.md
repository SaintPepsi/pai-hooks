# ModeAnalytics

## Overview

ModeAnalytics is a **SessionEnd** hook that collects mode usage data (Algorithm/Native/Minimal) and regenerates an analytics dashboard. It runs two external scripts in sequence: `CollectModeData.ts` scans session transcripts to update `mode-analytics.json`, then `GenerateDashboard.ts` reads that JSON and writes an HTML dashboard (auto-opening the browser every 25th run).

The hook always returns `silent` and never blocks session end, even if one of the scripts fails. Errors are logged to stderr for diagnostics.

## Event

`SessionEnd` — fires when a Claude Code session ends, triggering mode data collection and dashboard regeneration.

## When It Fires

- Every session end, unconditionally (accepts always returns true)
- The hook runs regardless of what happened during the session

It does **not** fire when:

- The session is still active (only fires on SessionEnd)
- The hook is removed from settings.json configuration

## What It Does

1. Resolves the `mode-analytics` tool directory under `$PAI_DIR/Tools/mode-analytics`
2. Runs `CollectModeData.ts` via `bun` with a 30-second timeout to scan transcripts and update the JSON data file
3. If collection fails, logs the error to stderr and returns silent (does not abort)
4. Runs `GenerateDashboard.ts` via `bun` with a 15-second timeout to regenerate the HTML dashboard
5. Logs success or failure of dashboard generation to stderr
6. Returns `silent` output in all cases

```typescript
// Sequential script execution
const collectResult = deps.execSyncSafe(
  `bun "${join(toolDir, "CollectModeData.ts")}"`, { timeout: 30000 }
);
if (!collectResult.ok) {
  deps.stderr(`[ModeAnalytics] Collection failed: ${collectResult.error.message}`);
  return ok({});
}

const genResult = deps.execSyncSafe(
  `bun "${join(toolDir, "GenerateDashboard.ts")}"`, { timeout: 15000 }
);
```

## Examples

### Example 1: Normal session end

> A session ends after the user worked in Algorithm mode for 45 minutes. ModeAnalytics fires, CollectModeData scans the transcript, records the mode usage in `mode-analytics.json`, and GenerateDashboard rebuilds the HTML dashboard. Both scripts succeed and the session closes cleanly.

### Example 2: Collection script fails

> A session ends but `CollectModeData.ts` times out after 30 seconds (e.g., corrupted transcript). The hook logs `[ModeAnalytics] Collection failed: ...` to stderr and returns silent immediately without attempting dashboard generation. The session still ends normally.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `process` | adapter | Provides `execSyncSafe` for running external scripts |
| `result` | core | Provides `ok` and `Result` type for error handling |
| `@anthropic-ai/claude-agent-sdk` | SDK | `SyncHookJSONOutput` return type — silent no-op via `ok({})` post-SDK-refactor, replaces legacy `SilentOutput` `{ type: "silent" }` |
| `CollectModeData.ts` | external tool | Scans transcripts and updates mode-analytics.json |
| `GenerateDashboard.ts` | external tool | Reads JSON data and writes HTML dashboard |
