# CheckAlgorithmVersion Hook

**Event:** SessionStart
**Contract:** `CheckAlgorithmVersion.contract.ts`
**Output:** Silent (writes state file for Banner.ts to read)

Compares local Algorithm version (from `PAI/Algorithm/LATEST`) against upstream GitHub
(`danielmiessler/PAI`). Writes update availability to `MEMORY/STATE/algorithm-update.json`.
Skips for subagents and respects a 6-hour check interval.

Fetches upstream via `gh api` with a 3-second timeout. Errors fail open (silent, no block).

See `CheckAlgorithmVersion.test.ts` for behavior coverage.
