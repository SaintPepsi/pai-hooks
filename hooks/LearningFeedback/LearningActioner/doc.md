# LearningActioner

## Overview

LearningActioner spawns a background analysis agent that reads accumulated learning signals (reflections, quality violations, and learning files) and produces structured improvement proposals. It uses a credit accumulation system based on API usage to control spawn frequency: each session end accumulates credit proportional to available capacity, and the agent only spawns when credit reaches the threshold of 10 (roughly equivalent to 10 low-usage sessions or 5 hours of work).

The spawned agent (via `run-learning-agent.ts` → `spawnAgent()` → `agent-runner.ts`) runs Claude with a detailed prompt that reads learning sources, studies the historical proposal corpus for calibration, and writes 0-3 evidence-backed proposals to `MEMORY/LEARNING/PROPOSALS/pending/`. A lock file with 45-minute stale timeout prevents concurrent agents, and the generic agent-runner handles cleanup in a finally block.

## Event

`SessionEnd` — fires when a session ends, evaluating whether enough credit has accumulated to warrant spawning an analysis agent.

## When It Fires

- A SessionEnd event occurs (always accepted)
- No fresh lock file exists at `MEMORY/LEARNING/PROPOSALS/.analyzing` (or the lock is stale > 45 minutes)
- Accumulated credit reaches the spawn threshold of 10
- Projected 5-hour API usage is below 100%
- At least one learning source file or directory exists

It does **not** fire when:

- A fresh lock file indicates another analysis agent is already running
- Accumulated credit is below the threshold of 10
- Projected 5-hour API usage would reach or exceed 100%
- No learning source files exist (no reflections, violations, or learning directories)
- Proposal directory creation fails

## What It Does

1. Checks for an existing lock file; if fresh (< 45 min), skips; if stale, removes it
2. Evaluates credit accumulation:
   - Reads current 5-hour usage utilization from `MEMORY/STATE/usage-cache.json`
   - Projects usage to end of window; hard-blocks if projected >= 100%
   - Reads current credit from `MEMORY/STATE/learning-agent-credit.json`
   - Adds increment: `(100 - utilization) / 100` (low usage = more credit)
   - If credit >= 10: resets to 0 and proceeds; otherwise persists and skips
3. Verifies learning sources exist (JSONL signal files or learning directories)
4. Ensures proposal subdirectories exist (pending, applied, rejected, deferred)
5. Calls `runLearningAgent()` which delegates to `spawnAgent()` for lock creation, traceability logging, and background spawning via the generic `agent-runner.ts`

```typescript
// Credit accumulation replaces fixed cooldown
const creditResult = evaluateCredit(deps.baseDir, deps);
deps.writeFile(creditPath, JSON.stringify({ credit: creditResult.newCredit, ... }));

if (!creditResult.shouldSpawn) return ok({ type: "silent" });

// Gate: learning sources must exist
if (!hasLearningSources(deps.baseDir, deps)) return ok({ type: "silent" });

// Spawn analysis agent via shared infrastructure
deps.runLearningAgent();
```

## Examples

### Example 1: Credit threshold reached after multiple sessions

> Over 12 low-usage sessions, credit accumulates from 0.0 to 10.2. On the 12th session end, LearningActioner detects the threshold is met, resets credit to 0, checks that learning sources exist, writes the lock file, and spawns the analysis agent. The agent reads reflections and quality violations, then writes 2 proposals to `MEMORY/LEARNING/PROPOSALS/pending/`.

### Example 2: High API usage blocks spawn

> You have been running heavy sessions. The 5-hour usage is at 80% with 1 hour remaining, projecting to 100%. LearningActioner calculates the projection, logs "projected 5h usage 100% >= 100%", and skips without accumulating any credit.

### Example 3: Lock prevents concurrent agents

> A previous LearningActioner agent is still running (lock file is 10 minutes old). The current session ends and LearningActioner finds the fresh lock, logs "Agent already running (lock file fresh), skipping", and returns silent.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `core/adapters/fs` | adapter | File operations for lock, credit state, and learning sources |
| `run-learning-agent.ts` | wrapper | Thin wrapper that calls `spawnAgent()` with learning-agent config |
| `lib/spawn-agent` | lib | Shared agent spawning with lock/log/traceability |
| `runners/agent-runner.ts` | runner | Generic background runner for all hook agents |
| `core/result` | core | Result type for error handling |
