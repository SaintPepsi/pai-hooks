# DuplicationChecker

## Overview

DuplicationChecker is a **PreToolUse** hook with tiered response that fires before writing or editing TypeScript files. It compares functions in the new code against a pre-built duplication index (created by DuplicationIndexBuilder) using 4 signal dimensions: body hash, name frequency, type signature, and fingerprint similarity.

Response tiers:
- **Body hash match**: Block the operation — identical code regardless of function name (configurable)
- **4/4 signals**: Block the operation (configurable)
- **2/4 or 3/4 signals** (no hash match): Log to `checker.jsonl` only (no block, no advisory)
- **1/4 signals**: Ignore (no log, no action)

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

The hook is branch-aware: each branch gets its own artifact directory (`/tmp/pai/duplication/{hash}/{branch}/`), so switching branches automatically uses a separate index and log. No rebuild needed when switching back.

## Event

`PreToolUse` — fires before Write or Edit operations on `.ts` files.

## When It Fires

- A Write or Edit tool targets a `.ts` file (not `.d.ts`)
- A duplication index (`index.json`) exists in the artifacts directory
- The new content contains extractable functions
- At least 2 signal dimensions match an existing function in the index

It does **not** fire when:

- The tool is not Write or Edit
- The target file is not a `.ts` file (or is a `.d.ts` definition file)
- No duplication index exists in the artifacts directory
- No functions are found in the new content
- Fewer than 2 signal dimensions match

## What It Does

1. Extracts the file path from the tool input (via shared `getFilePath`)
2. Searches for `index.json` in `/tmp/pai/duplication/{hash}/{branch}/` (with legacy fallback to project `.claude/`)
3. Loads and parses the index
4. For Write operations, uses the content directly; for Edit operations, simulates the edit via shared `simulateEdit`
5. Extracts function signatures from the content using SWC parser
6. Compares extracted functions against the index using `checkFunctions`
7. Logs all checks to `checker.jsonl` with branch metadata
8. At 4/4 signals and blocking enabled: returns block with per-match guidance — "Import it from X" when the target is a canonical source file, "Reuse the existing function from X or extract both to a shared module" otherwise
9. At 2-3/4 signals: logs finding, returns continue

```typescript
// Tiered response logic
const blockMatches = matches.filter((m) => m.signals.length >= BLOCK_THRESHOLD);

if (blockMatches.length > 0 && deps.blocking) {
  return ok({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}
// 2-3 signals: log only
return ok({ continue: true });
```

## Bug History

<!-- L14 tombstone: bug #15 (R2 additionalContext drop) — the `continueWithPatterns()` helper
returned `{ ...continueOk(), additionalContext: parts.join("\n\n") }` on PreToolUse. The
top-level `additionalContext` field is silently dropped by the SDK on PreToolUse events —
pattern advisories never reached the agent. Fixed in sdk-type-foundation migration (Task 1Q):
now returns `{ continue: true, hookSpecificOutput: { hookEventName: "PreToolUse",
additionalContext: parts.join("\n\n") } }`. Pattern advisories and derivation advisories are
now actually delivered. -->

<!-- L14 tombstone: bug #16 (R4-vs-R5 class) — the block return on 4/4 matches used
`{ type: "block", decision: "block", reason }` (R5 shape), which is silently dropped by the
SDK on PreToolUse events. Duplicate-block enforcement was non-functional. Fixed in
sdk-type-foundation migration (Task 1Q): now uses `hookSpecificOutput.permissionDecision:
"deny"` with `permissionDecisionReason` (R4 shape). Exact duplicates are now actually
blocked when `blocking: true`. -->

## Pattern Detection

Alongside pair-wise duplicate checking, DuplicationChecker detects **recurring codebase patterns** — functions whose name and signature appear across many files. When a new function matches such a pattern, the hook injects an advisory via `additionalContext` on a continue response. It never blocks.

### Two-tier signature matching

- **Tier 1 — full normalized signature**: the function's full normalized parameter + return signature is compared against the index. This catches patterns like `makeDeps` that share a complete signature shape across dozens of files.
- **Tier 2 — return-only fallback for domain types**: if Tier 1 misses and the return type is a non-primitive domain type, the return type alone is matched. This catches patterns like `makeInput` where parameter lists vary but the return shape is consistent.

### Advisory format

When a pattern is detected, the continue response includes `additionalContext` like:

```
Pattern detected: "makeDeps" (65 files)
  This function matches a recurring pattern. Consider extracting a shared factory.
  Examples: hooks/CanaryHook/CanaryHook.test.ts, hooks/GitSafety/GitAutoSync.test.ts, ...
```

### Configuration

Pattern detection thresholds are set in `hookConfig.duplicationChecker` in `settings.json` and applied at index build time:

| Option | Default | Description |
| --- | --- | --- |
| `patternThreshold` | `5` | Minimum number of files a signature must appear in to be flagged as a pattern |
| `requireSigMatch` | `true` | When true, the function name alone is not enough — the signature must also match |
| `sigMatchPercent` | `60` | Minimum percentage of a pattern's instances that must share the signature for a match |

```json
{
  "hookConfig": {
    "duplicationChecker": {
      "patternThreshold": 5,
      "requireSigMatch": true,
      "sigMatchPercent": 60
    }
  }
}
```

## Examples

### Example 1: Exact duplicate blocked (4/4 signals)

> The model writes a `getFilePath` function identical to one in `lib/tool-input.ts`. All 4 dimensions match (hash, name, sig, body). DuplicationChecker blocks with: "getFilePath duplicates lib/tool-input.ts:getFilePath (line 12) → Import it from lib/tool-input.ts". Because `lib/tool-input.ts` is a single-export source file whose name matches the function, it is tagged `source: true` and the guidance directs to import rather than extract.

### Example 2: Partial match logged (2-3 signals)

> The model writes a `makeDeps` function with a different body but matching name and signature. 2/4 dimensions match. DuplicationChecker logs the finding to `checker.jsonl` and returns continue silently.

### Example 3: Blocking disabled via config

> `settings.json` has `hookConfig.duplicationChecker.blocking: false`. A 4/4 match is logged but not blocked.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `result` | core | `ok()` for Result-based returns |
| `fs` | adapter | `readFile`, `fileExists`, `readJson`, `appendFile`, `ensureDir` |
| `lib/paths` | lib | `getSettingsPath` for reading hookConfig |
| `lib/tool-input` | lib | `getFilePath`, `getWriteContent` for extracting tool input fields |
| `DuplicationDetection/shared` | shared | `simulateEdit`, `loadIndex`, `findIndexPath`, `checkFunctions`, `getArtifactsDir`, `getCurrentBranch(cwd?)`, `BLOCK_THRESHOLD` |
| `DuplicationDetection/parser` | shared | `extractFunctions` for SWC-based function extraction |
| `lib/narrative-reader` | lib | `pickNarrative` for severity-tiered block message openers |
| `DuplicationChecker.narrative.jsonl` | data | 9 agent narratives (3 per severity tier) with DRY/WET theming |
| `inspector.ts` | cli | State inspector for `paih inspect DuplicationChecker` — reads index, returns summary/raw/JSON views |
