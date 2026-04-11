# CronDelete Hook

**Event:** PostToolUse (matcher: `CronDelete`)
**Contract:** `CronDelete.contract.ts`
**Output:** `SyncHookJSONOutput` — silent no-op (`ok({})`)

Removes a cron entry by ID from `MEMORY/STATE/crons/{sessionId}.json` when `CronDelete` tool
is called. Reads cron ID from `tool_input.id`. Deletes the session file entirely when the last
cron is removed.

Appends a `deleted` event to the JSONL log via `appendCronLog()` from `shared.ts`.

See `CronDelete.test.ts` for behavior coverage (12 tests).
