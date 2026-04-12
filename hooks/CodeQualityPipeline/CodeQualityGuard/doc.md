# CodeQualityGuard

## Overview

CodeQualityGuard is a **PostToolUse** hook that provides SOLID quality feedback after Edit and Write operations. It scores the modified file for quality violations and injects advisory warnings as `additionalContext`. It never blocks and never asks — it only advises.

When a baseline score exists (stored by CodeQualityBaseline), it computes the quality delta and reports whether the edit improved or degraded the file's quality. It also deduplicates violation reports, suppressing repeated identical warnings for the same file within a session.

## Event

`PostToolUse` — fires after Edit or Write operations, scoring the modified file and injecting quality advisories when violations or meaningful deltas are detected.

## When It Fires

- The tool used is `Edit` or `Write`
- The file path is a recognized scorable source file
- A language profile exists for the file type

It does **not** fire when:

- The tool is anything other than `Edit` or `Write` (e.g., Read, Bash)
- The file is not a recognized scorable type
- The file cannot be read after the edit
- No language profile exists for the file extension
- The file is a Svelte file with no `<script>` block

## What It Does

1. Extracts the file path from the tool input
2. Reads the file content after the edit (for Svelte files, extracts only the `<script>` block)
3. Scores the content against the language profile's quality checks
4. For test files, suppresses known false-positive checks (`type-import-ratio`, `options-object-width`)
5. Looks up the baseline score from CodeQualityBaseline and computes a quality delta if available
6. Deduplicates: if the violation set is identical to the last report for this file and there is no delta, skips context injection
7. Logs every execution to `quality-violations.jsonl` via the signal logger
8. If there are violations or a meaningful delta, injects the advisory as `additionalContext`

```typescript
// Delta computation and dedup check
const baseline = getBaselineScore(filePath, input.session_id, deps);
let deltaMessage: string | null = null;
if (baseline) {
  deltaMessage = deps.formatDelta(baseline, result, filePath);
}

const hash = violationHash(result.violations);
if (hash === prevHash && !deltaMessage) {
  return ok({ continue: true }); // deduped
}

// Advisory path (previously dropped — see History)
return ok({
  continue: true,
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: parts.join("\n"),
  },
});
```

## History

**Phase 1 Task 1O (2026-04-11)** — Latent bug #14 fixed. The R2 advisory site at
`CodeQualityGuard.contract.ts:237` was emitting `ok(continueOk(parts.join("\n")))` which became
a silent drop after Phase 0 Task 0C (commit `3705810`) deleted the runner's `formatOutput()`
translation layer. `validateHookOutput` fail-opened on the legacy shape, so SOLID quality
violations and delta advisories were never surfaced to the editor session. Fixed by migrating to
`hookSpecificOutput.additionalContext` per recipe R2 in
`/Users/hogers/.claude/pai-hooks/docs/plans/2026-04-10-sdk-type-foundation-implementation.md:62-77`.

## Examples

### Example 1: Quality degradation detected

> You edit `src/services/api.ts` which had a baseline of 8.0/10. After the edit, CodeQualityGuard scores it at 6.5/10 and injects: "Quality delta: 8.0 -> 6.5 (-1.5)" along with specific violations (e.g., missing type imports, function too long). Claude sees this warning and can proactively fix the issues.

### Example 2: Clean edit with no violations

> You edit `src/utils/format.ts` and the post-edit score is 9.0/10 with zero violations. CodeQualityGuard logs the clean score to `quality-violations.jsonl` but injects no context, keeping the conversation uncluttered.

### Example 3: Deduplicated repeated violations

> You make three consecutive edits to `src/legacy/parser.ts`, each time triggering the same set of violations. CodeQualityGuard reports the violations on the first edit but suppresses identical reports on the second and third edits, avoiding repetitive noise.

## Dependencies

| Dependency          | Type    | Purpose                                                        |
| ------------------- | ------- | -------------------------------------------------------------- |
| `language-profiles` | core    | Determines scorable files and provides check profiles          |
| `quality-scorer`    | core    | Scores content, formats advisories and quality deltas          |
| `signal-logger`     | lib     | Logs execution data to `quality-violations.jsonl` for analysis |
| `svelte-utils`      | lib     | Extracts `<script>` blocks from Svelte files                   |
| `fs`                | adapter | Reads file content and baseline store                          |
