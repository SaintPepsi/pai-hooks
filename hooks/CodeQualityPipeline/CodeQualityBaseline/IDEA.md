# Code Quality Baseline

> Score source files when they are first read and store the result as a baseline for regression detection.

## Problem

To detect whether an edit made quality better or worse, you need to know what the file looked like before. Without a pre-edit baseline, quality feedback can only report absolute scores, not directional changes. Authors are left guessing whether violations are pre-existing or newly introduced.

## Solution

When a source file is read during a session, score it against language-specific quality checks and store the score, violation count, and check results. This baseline is persisted for the session so that subsequent edits can compute a delta. For files that already score poorly (below a threshold), inject an advisory so authors know about pre-existing issues before they start editing.

## How It Works

1. When a source file is read, check whether it is a scorable file type and meets a minimum line count.
2. Score the file content against language-specific quality checks (e.g., function length, type coverage, complexity).
3. Store the score, violation count, and individual check results as the session baseline.
4. If the score is below a configurable threshold, inject a quality advisory into the output.
5. If the score is acceptable, store the baseline silently.

## Signals

- **Input:** File path and content on every read of a source code file
- **Output:** Stored baseline in session state, plus optional advisory for low-scoring files
