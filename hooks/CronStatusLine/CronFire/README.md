# CronFire Hook

**Event:** UserPromptSubmit (no matcher — fires on every prompt)
**Contract:** `CronFire.contract.ts`
**Output:** `SyncHookJSONOutput` — silent no-op (`ok({})`)

Detects cron fires by matching the submitted prompt against stored cron prompts in the current
session's file at `MEMORY/STATE/crons/{sessionId}.json`. Uses `prompt.includes(cron.prompt)`.

On match: increments `fireCount`, sets `lastFired` timestamp, writes updated file.
No-op when: no cron file exists, prompt is empty, or no match found. Designed for fast early
exit on the ~95% of prompts that aren't cron-triggered.

Appends a `fired` event to the JSONL log via `appendCronLog()` from `shared.ts`.

See `CronFire.test.ts` for behavior coverage (13 tests).
