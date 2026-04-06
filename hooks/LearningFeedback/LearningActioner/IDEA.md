# Learning Actioner

> Periodically analyze accumulated learning signals and propose evidence-backed improvements.

## Problem

Learning signals — ratings, sentiment, quality violations, session reflections — accumulate over time but are useless unless someone reviews them and acts. Manual review is tedious and infrequent, so insights rot in log files. The system needs an automated analyst that reads the signals, cross-references them, and proposes specific changes.

## Solution

At the end of each session, evaluate whether enough new learning has accumulated to justify spawning a background analysis agent. Use a credit accumulation model (not a fixed timer) so analysis frequency adapts to actual usage patterns and respects API rate limits. When the threshold is met, spawn an isolated agent that reads all learning sources, studies past proposal outcomes for calibration, and writes evidence-backed improvement proposals.

## How It Works

1. At session end, check for a lock file to prevent concurrent analysis agents.
2. Calculate a spawn credit based on current API usage — credits accumulate faster during low-usage periods and slower during heavy usage.
3. If accumulated credit exceeds the spawn threshold, acquire the lock and launch a background analysis process.
4. The analysis agent reads learning signals (ratings, reflections, quality violations), studies previously accepted and rejected proposals for calibration, and writes 0-3 proposals.
5. Each proposal includes evidence references, confidence scores, exact implementation content, and risk assessment.
6. The lock is released deterministically when the agent finishes, regardless of success or failure.

## Signals

- **Input:** Accumulated learning files (ratings, reflections, quality violations, session reports) and historical proposal outcomes
- **Output:** Improvement proposals with structured metadata (priority, category, confidence, evidence, risks) written to a pending review queue
