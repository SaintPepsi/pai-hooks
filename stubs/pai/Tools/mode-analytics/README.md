# Mode Analytics Stubs

Wrapper scripts that delegate to `.mjs` implementations for the ModeAnalytics hook.

## Files

- `CollectModeData.ts` — Wrapper that runs `CollectModeData.mjs` via Bun.spawn
- `GenerateDashboard.ts` — Wrapper that runs `GenerateDashboard.mjs` via Bun.spawn

## Deployment

Copy these files to `$PAI_DIR/Tools/mode-analytics/` along with the `.mjs` implementations.

The actual production tools live at `~/.claude/Tools/mode-analytics/` and are more sophisticated than these stubs.

## Purpose

These stubs exist for:
1. Compilation — allows pai-hooks to reference the tool paths
2. Fallback — minimal implementations if production tools are missing
