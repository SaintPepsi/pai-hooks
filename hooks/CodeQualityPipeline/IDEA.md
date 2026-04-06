# Code Quality Pipeline

> Continuous code quality scoring that measures every write against quality principles, tracks baselines, and surfaces regressions.

## Problem

Code quality degrades incrementally. Each individual change looks fine, but over time files accumulate violations — long functions, missing type annotations, poor separation of concerns. Without measurement at write-time, quality only gets assessed during periodic reviews when it is expensive to fix.

## Solution

Score every source file against a set of language-aware quality checks. Establish a baseline score when a file is first read, then re-score on every edit to detect regressions in real time. At session end, generate a summary report of all quality measurements. The system never blocks — it advises, so authors see quality trends as they work.

## How It Works

1. When a source file is read, score it against quality principles and store the result as a baseline for the session.
2. When a source file is written or edited, re-score it and compare against the baseline.
3. If quality regressed, inject an advisory showing what changed and which checks failed.
4. If quality improved or stayed the same, log silently.
5. At session end, aggregate all baselines and scores into a quality report written to persistent storage.

## Signals

- **Input:** File content on every read and write of source code files
- **Output:** Advisory messages on quality regressions, plus a session-end quality report

## Context

Quality checks are language-aware — each language has its own profile defining which checks apply and how they are weighted. The scoring system is extensible, so new quality checks can be added without changing the pipeline structure.
