# CodeQualityGuard

## Overview

CodeQualityGuard is a **PostToolUse** hook that provides SOLID quality feedback after Edit and Write operations. It scores the modified file for quality violations and injects advisory warnings as `additionalContext`. It never blocks and never asks — it only advises.

When a baseline score exists (stored by CodeQualityBaseline), it computes the quality delta and reports whether the edit improved or degraded the file's quality. It deduplicates violation reports within a session using a half-life strategy: identical violations are suppressed until either a configurable number of edits (`dedupHalfLifeEdits`, default 5) or a configurable time window (`dedupHalfLifeMs`, default 5 minutes) has elapsed, at which point the advisory resurfaces. If 3 or more prior sessions have flagged the same file with violations, the advisory is prefixed with a **REPEAT OFFENDER** escalation banner.

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
6. Applies half-life dedup: if the violation set is identical to the last report for this file and no delta exists, suppresses the advisory until either `dedupHalfLifeEdits` (default: 5) edits have accumulated or `dedupHalfLifeMs` (default: 5 minutes) has elapsed since the last report
7. Checks cross-session history: if 3 or more distinct prior sessions have flagged the same file with violations (via `quality-violations.jsonl`), prepends a **REPEAT OFFENDER** banner to the advisory
8. Logs every execution to `quality-violations.jsonl` via the signal logger
9. If there are violations or a meaningful delta, injects the advisory as `additionalContext`

```typescript
// Half-life dedup check
const hash = violationHash(result.violations);
const prevEntry = reportedViolations.get(filePath);
if (prevEntry && prevEntry.hash === hash && !deltaMessage) {
  const elapsed = Date.now() - prevEntry.timestamp;
  const nextEditCount = prevEntry.editCount + 1;
  const halfLifeExpired =
    nextEditCount >= deps.dedup.halfLifeEdits ||
    elapsed >= deps.dedup.halfLifeMs;
  if (!halfLifeExpired) {
    return ok({ continue: true }); // suppressed within half-life
  }
  // half-life expired — fall through to resurface
}
reportedViolations.set(filePath, { hash, timestamp: Date.now(), editCount: 0 });

// Cross-session escalation
const crossSessionCount = hasViolations
  ? deps.dedup.countCrossSessionViolations(deps.signal.baseDir, filePath, input.session_id)
  : 0;
if (crossSessionCount >= 3) {
  parts.push(`⚠ REPEAT OFFENDER: ${filePath} has been flagged in ${crossSessionCount} prior sessions.`);
}
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

### Example 3: Half-life dedup suppresses then resurfaces

> You make six consecutive edits to `src/legacy/parser.ts`, each triggering the same violations. CodeQualityGuard reports on edit 1, suppresses edits 2–5 (within the half-life window of 5 edits), then resurfaces the advisory on edit 6 as a reminder that the issues remain unaddressed.

### Example 4: Cross-session repeat offender escalation

> `src/services/api.ts` has been flagged with SOLID violations in 3 previous sessions. When CodeQualityGuard fires again, the advisory begins with "⚠ REPEAT OFFENDER: src/services/api.ts has been flagged in 3 prior sessions." — signalling that this file has a persistent quality problem that warrants deeper attention.

## Dependencies

| Dependency          | Type    | Purpose                                                                              |
| ------------------- | ------- | ------------------------------------------------------------------------------------ |
| `language-profiles` | core    | Determines scorable files and provides check profiles                                |
| `quality-scorer`    | core    | Scores content, formats advisories and quality deltas                                |
| `signal-logger`     | lib     | Logs execution data to `quality-violations.jsonl` for analysis                       |
| `jsonl-reader`      | lib     | Reads cross-session violation counts from `quality-violations.jsonl` for escalation  |
| `svelte-utils`      | lib     | Extracts `<script>` blocks from Svelte files                                         |
| `fs`                | adapter | Reads file content and baseline store                                                |
