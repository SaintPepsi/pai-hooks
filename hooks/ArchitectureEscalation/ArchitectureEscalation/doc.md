# ArchitectureEscalation

## Overview

ArchitectureEscalation is a **PostToolUse** hook that tracks repeated failed fix attempts on specific criteria (tasks). When a criterion transitions to `in_progress` multiple times, it indicates the current approach is not working. After 3 failed attempts, the hook injects a warning. After 5, it recommends stopping the current approach entirely and escalating to architectural analysis.

This pattern is inspired by obra/superpowers systematic-debugging skill Phase 4.5, designed to break the cycle of Claude repeatedly trying the same failing fix strategy.

## Event

`PostToolUse` — fires after a `TaskUpdate` tool call, tracking `in_progress` transitions per criterion and injecting escalation warnings when thresholds are exceeded.

## When It Fires

- The tool used is `TaskUpdate`
- The `status` field is `"in_progress"`
- The `taskId` field is a non-empty string

It does **not** fire when:

- The tool is anything other than `TaskUpdate`
- The status is not `"in_progress"` (e.g., `"done"`, `"blocked"`)
- The `taskId` is missing or empty
- The criterion has fewer than 3 `in_progress` transitions (no warning threshold reached)

## What It Does

1. Extracts `taskId` and `status` from the tool input
2. Loads the per-session escalation state from `MEMORY/STATE/arch-escalation-{session_id}.json`
3. Increments the `inProgressCount` for the criterion and saves the updated state
4. Computes `failedAttempts` as `inProgressCount - 1` (first transition is the initial attempt)
5. At 3+ failed attempts: injects a **warning** recommending FirstPrinciples and Council skills
6. At 5+ failed attempts: injects a **stop** escalation telling Claude to abandon the current approach

```typescript
if (failedAttempts >= STOP_THRESHOLD) {
  // "STOP CURRENT APPROACH" — recommends FirstPrinciples + Council skills
  return ok({ type: "continue", continue: true, additionalContext: message });
}
if (failedAttempts >= WARN_THRESHOLD) {
  // "WARNING" — suggests pausing and questioning the approach
  return ok({ type: "continue", continue: true, additionalContext: message });
}
```

## Examples

### Example 1: Warning after 3 failed attempts

> Claude is trying to fix a failing test for criterion `ISC-004`. It has set `ISC-004` to `in_progress` four times (3 failed attempts). ArchitectureEscalation injects: "ARCHITECTURE ESCALATION WARNING -- 3 failed attempts on ISC-004. Repeated failures often signal an architectural problem. CONSIDER: Use FirstPrinciples skill to decompose the root cause."

### Example 2: Stop escalation after 5 failed attempts

> After 6 transitions to `in_progress` on `ISC-004` (5 failures), ArchitectureEscalation injects: "ARCHITECTURE ESCALATION -- STOP CURRENT APPROACH. Criterion ISC-004 has failed 5 times. This strongly indicates a fundamental architectural problem. Do NOT make another targeted fix attempt."

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `fs` | adapter | Reads and writes per-session escalation state JSON |
