# Code Quality Guard

> Score code against quality principles on every write and warn about regressions.

## Problem

Quality violations are easiest to fix at the moment they are introduced — when the author still has full context. If feedback comes later (in CI, code review, or audits), the fix is more expensive and less likely to happen. Authors need immediate, specific feedback on what they just wrote.

## Solution

After every file write or edit, re-score the file against language-specific quality checks and compare against the session baseline (if one exists). If quality regressed, inject an advisory showing the score change and which checks failed. Use a half-life dedup strategy to suppress identical violation reports within a session — resurface only after a configurable number of edits or elapsed time, so the author gets periodic reminders without constant noise. Escalate with a "repeat offender" banner when the same file has been flagged across multiple sessions. Log every score to persistent storage for trend analysis.

## How It Works

1. After a file is written or edited, read the new content and score it against quality checks.
2. If a baseline exists for this file (from a prior read), compute the quality delta.
3. If violations exist, format an advisory message listing each violation's category, severity, and suggestion.
4. Apply half-life dedup: if the violation set is identical to the last report, suppress the advisory until either a configurable edit count or time window threshold has been exceeded — then resurface and reset the counter.
5. Check cross-session history: count distinct prior sessions that logged violations for this file. If 3 or more sessions are found, prepend a "REPEAT OFFENDER" escalation to the advisory.
6. Log the score, violations, and metadata to a persistent signal log for trend analysis.

## Signals

- **Input:** File path and content on every file write or edit of a source code file
- **Output:** Advisory message with quality score, violations, regression delta, and optional repeat-offender escalation — or silent pass if clean or within dedup half-life
