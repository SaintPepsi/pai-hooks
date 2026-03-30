# DuplicationChecker

## Overview

DuplicationChecker is a **PreToolUse** hook with tiered response that fires before writing or editing TypeScript files. It compares functions in the new code against a pre-built duplication index (created by DuplicationIndexBuilder) using 4 signal dimensions: body hash, name frequency, type signature, and fingerprint similarity.

Response tiers based on signal count:
- **1/4 signals**: Ignore (no log, no action)
- **2/4 or 3/4 signals**: Log to `.duplication-checker.log` only (no block, no advisory)
- **4/4 signals**: Block the operation (configurable)

Blocking can be disabled via `settings.json`:
```json
{
  "hookConfig": {
    "duplicationChecker": {
      "blocking": false
    }
  }
}
```

The hook is branch-aware: the index records which git branch it was built on, and is discarded when the branch changes. Log entries also include the current branch.

## Event

`PreToolUse` — fires before Write or Edit operations on `.ts` files.

## When It Fires

- A Write or Edit tool targets a `.ts` file (not `.d.ts`)
- A duplication index (`.duplication-index.json`) exists in the project
- The index was built on the current git branch
- The new content contains extractable functions
- At least 2 signal dimensions match an existing function in the index

It does **not** fire when:

- The tool is not Write or Edit
- The target file is not a `.ts` file (or is a `.d.ts` definition file)
- No duplication index exists in the project hierarchy
- The index was built on a different git branch (discarded)
- No functions are found in the new content
- Fewer than 2 signal dimensions match

## What It Does

1. Extracts the file path from the tool input (via shared `getFilePath`)
2. Searches up the directory tree for a `.duplication-index.json` file
3. Loads and parses the index; discards if built on a different branch
4. Checks the index age against the staleness threshold (300s)
5. For Write operations, uses the content directly; for Edit operations, simulates the edit via shared `simulateEdit`
6. Extracts function signatures from the content using SWC parser
7. Compares extracted functions against the index using `checkFunctions`
8. Logs all checks to `.duplication-checker.log` with branch metadata
9. At 4/4 signals and blocking enabled: returns block with reason listing duplicate targets
10. At 2-3/4 signals: logs finding, returns continue

```typescript
// Tiered response logic
const blockMatches = matches.filter((m) => m.signals.length >= BLOCK_THRESHOLD);

if (blockMatches.length > 0 && deps.blocking) {
  return ok({ type: "block", decision: "block", reason });
}
// 2-3 signals: log only
return ok({ type: "continue", continue: true });
```

## Examples

### Example 1: Exact duplicate blocked (4/4 signals)

> The model writes a `getFilePath` function identical to one in `shared.ts`. All 4 dimensions match (hash, name, sig, body). DuplicationChecker blocks: "Exact duplicate function(s) detected: getFilePath duplicates shared.ts:getFilePath. Reuse the existing function."

### Example 2: Partial match logged (2-3 signals)

> The model writes a `makeDeps` function with a different body but matching name and signature. 2/4 dimensions match. DuplicationChecker logs the finding to `.duplication-checker.log` and returns continue silently.

### Example 3: Blocking disabled via config

> `settings.json` has `hookConfig.duplicationChecker.blocking: false`. A 4/4 match is logged but not blocked.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `result` | core | `ok()` for Result-based returns |
| `fs` | adapter | `readFile`, `fileExists`, `readJson`, `appendFile`, `ensureDir` |
| `lib/paths` | lib | `getSettingsPath` for reading hookConfig |
| `DuplicationDetection/shared` | shared | `getFilePath`, `getWriteContent`, `simulateEdit`, `loadIndex`, `findIndexPath`, `checkFunctions`, `formatFindings`, `getCurrentBranch`, `BLOCK_THRESHOLD`, `STALENESS_SECONDS` |
| `DuplicationDetection/parser` | shared | `extractFunctions` for SWC-based function extraction |
| `lib/narrative-reader` | lib | `pickNarrative` for severity-tiered block message openers |
| `DuplicationChecker.narrative.jsonl` | data | 9 agent narratives (3 per severity tier) with DRY/WET theming |
