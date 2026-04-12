# Pattern Detection for DuplicationChecker

**Date:** 2026-04-06
**Status:** Approved
**Scope:** DuplicationDetection hook group (pai-hooks)

## Problem

The DuplicationChecker detects pair-wise duplicates (`shared.ts:199-289`) but misses **recurring patterns** — functions that appear across many files with the same shape. Example: `makeDeps(overrides: Partial<T>): T` exists in 65 test files, `makeInput` in 37 (source: `nameGroups` in `/tmp/pai/duplication/685e053b/main/index.json`). The checker flags individual pairs but never surfaces that these are systemic patterns worth consolidating into shared utilities.

## Solution

Add **auto-detected pattern recognition** to the existing DuplicationDetection pipeline. The index builder identifies recurring name+sig clusters; the checker advises when new code matches a known pattern.

## Approach

**Auto-detect v1** — patterns emerge organically from the index data. No manual config required. A manual override layer (named patterns, custom suggestions, threshold overrides) is a planned follow-on once shared utilities exist to point to.

## Architecture

### Two-Tier Sig Matching

Raw signatures use concrete types (`(Partial<SessionSummaryDeps>)→SessionSummaryDeps`) because the parser (`parser.ts:221-232`) resolves `Partial<T>` to concrete types via `serializeType()` (`parser.ts:131-155`). Identical patterns produce different sig strings. A normalizer resolves this:

**Tier 1 — Full sig match (params + return, both normalized):**

- `Partial<ConcreteType>` → `Partial<*>`
- `Record<K,V>` → `Record<*,*>`
- `*Deps` / `*Input` / `*Output` suffixes → wildcard
- Catches: `makeDeps` (91%), `shortenPath` (88%), `blockCountPath` (88%)

**Tier 2 — Return-only fallback (for domain types only):**

- If tier 1 doesn't reach threshold, match on normalized return type alone
- Only applies when return type is a **domain type** (not `string`, `void`, `number`, `boolean`)
- Catches: `makeInput` (100%), `makeToolInput` (100%)
- Filters out: `main` (void), `run` (void), `getStateDir` (string)

### Index Changes

New field in `DuplicationIndex`:

```ts
interface PatternEntry {
  id: string; // "makeDeps:(Partial<*>)→*Deps"
  name: string; // "makeDeps"
  sig: string; // normalized sig that matched
  tier: 1 | 2; // which tier matched
  fileCount: number; // 65
  files: string[]; // first 5 example file paths
}
```

`patterns: PatternEntry[]` added to the existing `DuplicationIndex` type (`shared.ts:28-39`). Built during the index builder's post-processing pass.

### Builder Logic

After building entries (existing flow):

1. For each `nameGroup` with count >= `patternThreshold`:
2. Count normalized sigs within the group — O(n) per group, O(total entries) overall
3. If dominant sig covers >= `sigMatchPercent` of group → emit pattern (tier 1)
4. If tier 1 fails and dominant normalized return is a domain type with >= `sigMatchPercent` → emit pattern (tier 2)

### Checker Logic

Before existing pair-wise check:

1. Look up `index.patterns` for incoming function's name
2. If found → inject `additionalContext` on the continue response (same mechanism used for derivation matches at `DuplicationChecker.contract.ts:197-206`)
3. Proceed with normal pair-wise checking (independent concerns)

Advisory message format:

```
Pattern detected: "makeInput" (37 instances across 37 files)
This function matches a recurring pattern. Consider extracting a shared factory.
Examples: hooks/AgentExecutionGuard/AgentExecutionGuard.test.ts, ...
```

### Config

All optional, via `hookConfig.duplicationChecker` (read by `readHookConfig()` from `lib/hook-config.ts`, existing pattern at `DuplicationChecker.contract.ts:57-60`):

```json
{
  "patternThreshold": 5,
  "requireSigMatch": true,
  "sigMatchPercent": 60
}
```

- `patternThreshold`: min files to qualify as pattern (default 5)
- `requireSigMatch`: enable/disable sig matching (default true)
- `sigMatchPercent`: % of group sharing a sig to qualify (default 60)

## Files Changed

| File                                  | Change                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `shared.ts`                           | Add `PatternEntry` type, `normalizeSig()`, `normalizeReturn()`, `isPrimitiveSig()` pure functions |
| `DuplicationIndexBuilder.contract.ts` | Add pattern detection pass after building entries                                                 |
| `DuplicationChecker.contract.ts`      | Pattern lookup before pair-wise check, inject `additionalContext`                                 |
| `DuplicationChecker.test.ts`          | Test pattern advisory path                                                                        |
| `DuplicationIndexBuilder.test.ts`     | Test pattern detection with threshold/sig configs                                                 |
| `shared.test.ts`                      | Test normalization functions and two-tier logic                                                   |
| `checker.jsonl`                       | Add optional `patterns` field to log entries                                                      |

No new files. No new dependencies. All within the DuplicationDetection hook group.

## Data Validation

Tested against live index data (`/tmp/pai/duplication/685e053b/main/index.json` and `/tmp/pai/duplication/6ccd20e7/main/index.json`, 2026-04-06):

| Pattern           | Files | Tier            | Match %       | Detected? |
| ----------------- | ----- | --------------- | ------------- | --------- |
| `makeDeps`        | 65    | 1 (full sig)    | 91%           | Yes       |
| `makeInput`       | 37    | 2 (return-only) | 100%          | Yes       |
| `makeToolInput`   | 7     | 2 (return-only) | 100%          | Yes       |
| `shortenPath`     | 8     | 1 (full sig)    | 88%           | Yes       |
| `blockCountPath`  | 8     | 1 (full sig)    | 88%           | Yes       |
| `uniqueSessionId` | 6     | 1 (full sig)    | 100%          | Yes       |
| `main`            | 6     | -               | void return   | Filtered  |
| `run`             | 9     | -               | void return   | Filtered  |
| `getStateDir`     | 7     | -               | string return | Filtered  |

## Future Work

- **Manual override layer**: named patterns, custom suggestions pointing to shared utilities, per-pattern threshold overrides, suppression
- **Pattern consolidation tracking**: once shared factories exist, track migration progress (how many files still use the local copy vs the shared import)
