# CronCreate Hook

**Event:** PostToolUse (matcher: `CronCreate`)
**Contract:** `CronCreate.contract.ts`
**Output:** `SyncHookJSONOutput` — silent no-op (`ok({})`), no context added to conversation

Persists new cron entries to `MEMORY/STATE/crons/{sessionId}.json` when `CronCreate` tool is called.
Reads schedule from `tool_input.cron` (falls back to `tool_input.schedule`), cron ID from
`tool_response.id`, and display name from `tool_response.humanSchedule`.

Appends a `created` event to the JSONL log via `appendCronLog()` from `shared.ts`.

See `CronCreate.test.ts` for behavior coverage (12 tests).
