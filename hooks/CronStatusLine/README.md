# CronStatusLine Hook Group

Persists cron job state to disk for the PAI status line to display. Crons are session-scoped
and in-memory (die on exit), so these hooks bridge the gap between Claude's cron system and
the external statusline process.

## Architecture

```
CronCreate/  — PostToolUse on CronCreate  → writes new cron to session file + JSONL log
CronDelete/  — PostToolUse on CronDelete  → removes cron, deletes file if empty
CronFire/    — UserPromptSubmit            → matches prompt against stored crons, bumps fireCount
CronPrune/      — SessionStart               → removes orphan files from dead sessions (mtime > 5min)
CronSessionEnd/ — SessionEnd                 → removes this session's cron file on clean exit
shared.ts       — Types, path helpers, file I/O used by all five hooks
```

## State Files

Per-session JSON at `MEMORY/STATE/crons/{sessionId}.json`:

```json
{
  "sessionId": "fb745fc0-...",
  "crons": [{
    "id": "cron_abc",
    "name": "Every 2 minutes",
    "schedule": "*/2 * * * *",
    "recurring": true,
    "prompt": "Full cron prompt text",
    "createdAt": 1711234567,
    "fireCount": 47,
    "lastFired": 1711234800
  }]
}
```

## Retrospective Log

JSONL at `MEMORY/STATE/logs/cron-log-YYYY-MM-DD.jsonl` with events: created, fired, deleted, pruned.

## Hook Registration

Each hook directory contains its own `settings.hooks.json` defining how it should be registered.
The pai-hooks installer discovers and merges these automatically.

## Design Doc

`docs/plans/2026-03-24-cron-statusline-design.md`

## Output Type

All five hooks return `SyncHookJSONOutput` from `@anthropic-ai/claude-agent-sdk` directly.
Silent no-ops are emitted as `ok({})` — no wrapper types.
