# Code Quality Guard

> Score code against quality principles on every write and warn about regressions.

## Problem

Quality violations are easiest to fix at the moment they are introduced — when the author still has full context. If feedback comes later (in CI, code review, or audits), the fix is more expensive and less likely to happen. Authors need immediate, specific feedback on what they just wrote.

## Solution

After every file write or edit, re-score the file against language-specific quality checks and compare against the session baseline (if one exists). If quality regressed, inject an advisory showing the score change and which checks failed. Deduplicate identical violation reports within a session to avoid noise. Log every score to persistent storage for trend analysis.

## How It Works

1. After a file is written or edited, read the new content and score it against quality checks.
2. If a baseline exists for this file (from a prior read), compute the quality delta.
3. If violations exist, format an advisory message listing each violation's category, severity, and suggestion.
4. If the violations are identical to the last report for this file, suppress the duplicate.
5. Log the score, violations, and metadata to a persistent signal log for trend analysis.

## Signals

- **Input:** File path and content on every file write or edit of a source code file
- **Output:** Advisory message with quality score, violations, and regression delta, or silent pass if clean
