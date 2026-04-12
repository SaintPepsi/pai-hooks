# CodeQualityBaseline

## Overview

CodeQualityBaseline is a **PostToolUse** hook that captures quality scores for source files when they are first read during a session. It scores each file using language-specific quality profiles and stores the result as a baseline in a per-session JSON file. These baselines are later consumed by CodeQualityGuard to compute quality deltas after edits.

For files with pre-existing quality concerns (score below 6.0), it injects an advisory into the conversation context so Claude is aware of the file's condition before making changes.

## Event

`PostToolUse` — fires after a Read tool operation completes, scoring the file and persisting its quality baseline for later delta comparison.

## When It Fires

- The tool used is `Read`
- The file path is a scorable source file (recognized by language profiles)
- The file is not a test file (no `.test.`, `.spec.`, `_test.`, `_spec.`, `__tests__/`, `/test/`, `/tests/`)
- The file has at least 50 lines
- A language profile exists for the file type

It does **not** fire when:

- The tool is anything other than `Read`
- The file is a test file
- The file is not a recognized scorable type (e.g., images, configs)
- The file has fewer than 50 lines
- The file is a Svelte file with no `<script lang="ts">` block

## What It Does

1. Extracts the file path from the tool input
2. Reads the file content (for Svelte files, extracts only the `<script>` block)
3. Skips files under 50 lines
4. Looks up the language profile for the file extension
5. Scores the file content against the language profile's quality checks
6. Loads or creates the per-session baseline store at `MEMORY/STATE/quality-baselines-{session_id}.json`
7. Writes the score, violation count, check results, and timestamp to the store
8. If the score is below 6.0, formats and injects an advisory as `additionalContext`

```typescript
// Baseline storage and low-score advisory injection
store[filePath] = {
  score: result.score,
  violations: result.violations.length,
  checkResults: result.checkResults,
  timestamp: deps.getTimestamp(),
};
deps.writeJson(baselinePath, store);

if (result.score < LOW_SCORE_THRESHOLD) {
  const advisory = deps.formatAdvisory(result, filePath);
  return ok({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: advisory,
    },
  });
}
```

## History

**Phase 1 Task 1O (2026-04-11)** — Latent bug #13 fixed. The R2 advisory site at
`CodeQualityBaseline.contract.ts:173` was emitting `ok(continueOk("Note: Pre-existing quality
concerns detected.\n..."))` which became a silent drop after Phase 0 Task 0C (commit `3705810`)
deleted the runner's `formatOutput()` translation layer. `validateHookOutput` fail-opened on the
legacy shape, so the pre-existing quality advisory injected into PostToolUse was never delivered.
Fixed by migrating to `hookSpecificOutput.additionalContext` per recipe R2 in
`/Users/hogers/.claude/pai-hooks/docs/plans/2026-04-10-sdk-type-foundation-implementation.md:62-77`.

## Examples

### Example 1: Baseline stored for a clean file

> You read `src/utils/parser.ts` (200 lines). CodeQualityBaseline scores it at 8.5/10 with zero violations. The baseline is stored silently — no context is injected since the score is above 6.0. Later, when CodeQualityGuard runs after an edit, it compares against this 8.5 baseline to report whether quality improved or degraded.

### Example 2: Low-quality file triggers advisory

> You read `src/legacy/handler.ts` which scores 4.2/10 with multiple violations (missing type imports, oversized functions, no options objects). CodeQualityBaseline stores the baseline and injects an advisory: "Note: Pre-existing quality concerns detected." followed by specific violation details. This warns Claude before it starts editing a problematic file.

## Dependencies

| Dependency          | Type    | Purpose                                                                        |
| ------------------- | ------- | ------------------------------------------------------------------------------ |
| `language-profiles` | core    | Determines if a file is scorable and provides language-specific check profiles |
| `quality-scorer`    | core    | Scores file content and formats advisory messages                              |
| `svelte-utils`      | lib     | Extracts `<script>` blocks from Svelte files for scoring                       |
| `fs`                | adapter | File read/write operations for baseline persistence                            |
