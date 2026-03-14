/**
 * LearningActioner Contract — Spawn background agent to analyze learnings.
 *
 * At SessionEnd, checks if learning sources exist. If so, spawns a bun wrapper
 * (learning-agent-runner.ts) that runs claude synchronously and handles cleanup
 * deterministically in code, not via prompt instructions.
 *
 * Mitigations:
 * - Lock file prevents concurrent agents (.analyzing with 10-min stale timeout)
 * - Cooldown file prevents redundant runs (.last-analysis with 6-hour window)
 * - Wrapper cleans up lock + cooldown in finally block (no prompt-based cleanup)
 * - Lock persists during child claude's SessionEnd hooks, preventing recursion
 * - Agent reads pending/ proposals to avoid duplicates
 * - max-turns caps agent cost
 */

import type { HookContract } from "@hooks/core/contract";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import type { SilentOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import {
  fileExists,
  readDir,
  writeFile,
  removeFile,
  ensureDir,
  stat,
} from "@hooks/core/adapters/fs";
import { spawnBackground } from "@hooks/core/adapters/process";
import { join } from "path";
import { getISOTimestamp } from "@hooks/lib/time";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LearningActionerDeps {
  fileExists: (path: string) => boolean;
  readDir: (path: string, opts?: { withFileTypes: true }) => Result<any[], PaiError>;
  writeFile: (path: string, content: string) => Result<void, PaiError>;
  removeFile: (path: string) => Result<void, PaiError>;
  ensureDir: (path: string) => Result<void, PaiError>;
  stat: (path: string) => Result<{ mtimeMs: number }, PaiError>;
  spawnBackground: (cmd: string, args: string[], opts?: { cwd?: string }) => Result<void, PaiError>;
  getISOTimestamp: () => string;
  baseDir: string;
  stderr: (msg: string) => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const LOCK_STALE_MS = 10 * 60 * 1000; // 10 minutes (Haiku agents can take 3-5 min on large files)
const COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours between analysis runs

const LEARNING_SOURCES = [
  "MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl",
  "MEMORY/LEARNING/SIGNALS/ratings.jsonl",
  "MEMORY/LEARNING/SIGNALS/quality-violations.jsonl",
];

const LEARNING_DIRS = [
  "MEMORY/LEARNING/ALGORITHM",
  "MEMORY/LEARNING/SYSTEM",
  "MEMORY/LEARNING/QUALITY",
];

// ─── Agent Prompt ────────────────────────────────────────────────────────────

export function buildAgentPrompt(baseDir: string): string {
  return `You are analyzing PAI system learnings to find actionable improvement proposals.

WORKING DIRECTORY: ${baseDir}

Read the following learning sources (all paths relative to ${baseDir}):
1. MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl — Algorithm Q1/Q2/Q3 reflections (read only the last 50 lines)
2. MEMORY/LEARNING/ALGORITHM/ — Recent algorithm learning .md files
3. MEMORY/LEARNING/SYSTEM/ — Recent system learning .md files
4. MEMORY/LEARNING/SIGNALS/ratings.jsonl — Sentiment ratings over time (read only the last 50 lines)
5. MEMORY/LEARNING/SIGNALS/quality-violations.jsonl — SOLID quality violations per file (read only the last 50 lines)
6. MEMORY/LEARNING/QUALITY/ — Session quality reports

Also read existing proposals to avoid re-proposing:
7. MEMORY/LEARNING/PROPOSALS/pending/ — Already pending proposals (DO NOT duplicate these)
8. MEMORY/LEARNING/PROPOSALS/applied/ — Already applied proposals
9. MEMORY/LEARNING/PROPOSALS/rejected/ — Already rejected proposals

For each actionable pattern you find, write a proposal file to:
  ${baseDir}/MEMORY/LEARNING/PROPOSALS/pending/

Filename format: {YYYYMMDD}-{HHMMSS}-{slug}.md
Where slug is the proposal title lowercased, special chars stripped, spaces to hyphens, max 40 chars.

Each proposal file must use this format:

---
id: PROP-{YYYYMMDD}-{N}
created: {ISO timestamp}
source_learnings:
  - {relative path to learning file 1}
  - {relative path to learning file 2}
status: pending
priority: low | medium | high
category: steering-rule | memory | hook | skill | workflow
---

# Proposal: {Title}

## What was learned
{Summary of the pattern detected across learning sources}

## Proposed change
**Target file:** {path relative to ${baseDir}}
**Change type:** append | edit | create

### Content to add/change:
{The actual content to be added or changed, ready to apply}

## Rationale
{Links to source learnings with timestamps and quotes}

---

Focus on:
- Recurring themes in Q2 reflections (algorithm improvements)
- Low sentiment ratings (<=5) with clear causes
- Quality score patterns (files repeatedly scoring low)
- Execution patterns from Q1 (recurring mistakes)

Valid proposal categories:
- steering-rule: New or modified AI steering rule in PAI/USER/AISTEERINGRULES.md
- memory: Update to auto-memory MEMORY.md or wisdom frames
- hook: Suggest a hook modification (describe what to change)
- skill: Suggest a skill improvement
- workflow: Suggest a workflow change

Each proposal must include the exact content to add/change.
Write 0 proposals if nothing is actionable — don't force it.

IMPORTANT: Be concise. Read files, analyze, write proposals, exit.
Do NOT output verbose explanations. Just do the work.`;
}

// ─── Pure Logic ──────────────────────────────────────────────────────────────

function hasLearningSources(baseDir: string, deps: LearningActionerDeps): boolean {
  // Check individual source files
  for (const source of LEARNING_SOURCES) {
    if (deps.fileExists(join(baseDir, source))) return true;
  }

  // Check learning directories for any files
  for (const dir of LEARNING_DIRS) {
    const fullDir = join(baseDir, dir);
    if (!deps.fileExists(fullDir)) continue;
    const entries = deps.readDir(fullDir, { withFileTypes: true });
    if (entries.ok && entries.value.length > 0) return true;
  }

  return false;
}

function isTimestampFresh(path: string, maxAgeMs: number, deps: LearningActionerDeps): boolean {
  const s = deps.stat(path);
  if (!s.ok) return false;
  return (Date.now() - s.value.mtimeMs) < maxAgeMs;
}

// ─── Contract ────────────────────────────────────────────────────────────────

const BASE_DIR = process.env.PAI_DIR || join(process.env.HOME!, ".claude");

const defaultDeps: LearningActionerDeps = {
  fileExists,
  readDir,
  writeFile,
  removeFile,
  ensureDir,
  stat,
  spawnBackground,
  getISOTimestamp,
  baseDir: BASE_DIR,
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const LearningActioner: HookContract<
  SessionEndInput,
  SilentOutput,
  LearningActionerDeps
> = {
  name: "LearningActioner",
  event: "SessionEnd",

  accepts(_input: SessionEndInput): boolean {
    return true;
  },

  execute(
    _input: SessionEndInput,
    deps: LearningActionerDeps,
  ): Result<SilentOutput, PaiError> {
    const proposalsDir = join(deps.baseDir, "MEMORY/LEARNING/PROPOSALS");
    const lockPath = join(proposalsDir, ".analyzing");
    const cooldownPath = join(proposalsDir, ".last-analysis");

    // Check for existing lock (another agent is already running)
    if (deps.fileExists(lockPath)) {
      if (isTimestampFresh(lockPath, LOCK_STALE_MS, deps)) {
        deps.stderr("[LearningActioner] Agent already running (lock file fresh), skipping");
        return ok({ type: "silent" });
      }
      // Stale lock — clean up
      deps.stderr("[LearningActioner] Cleaning up stale lock file");
      const removeResult = deps.removeFile(lockPath);
      if (!removeResult.ok) {
        deps.stderr(`[LearningActioner] Failed to remove stale lock: ${removeResult.error.message}`);
      }
    }

    // Check cooldown — don't run more than once per 6 hours
    if (deps.fileExists(cooldownPath)) {
      if (isTimestampFresh(cooldownPath, COOLDOWN_MS, deps)) {
        deps.stderr("[LearningActioner] Within cooldown window, skipping");
        return ok({ type: "silent" });
      }
    }

    // Check if any learning sources exist
    if (!hasLearningSources(deps.baseDir, deps)) {
      deps.stderr("[LearningActioner] No learning sources found, skipping");
      return ok({ type: "silent" });
    }

    // Ensure proposals directories exist
    for (const sub of ["pending", "applied", "rejected"]) {
      const result = deps.ensureDir(join(proposalsDir, sub));
      if (!result.ok) {
        deps.stderr(`[LearningActioner] Failed to create ${sub} dir: ${result.error.message}`);
        return ok({ type: "silent" });
      }
    }

    // Write lock file
    const lockResult = deps.writeFile(lockPath, deps.getISOTimestamp());
    if (!lockResult.ok) {
      deps.stderr(`[LearningActioner] Failed to write lock file: ${lockResult.error.message}`);
      return ok({ type: "silent" });
    }

    // Spawn wrapper that runs claude synchronously then cleans up deterministically
    // Wrapper imports buildAgentPrompt directly — no temp files needed
    const wrapperPath = join(deps.baseDir, "pai-hooks/runners/learning-agent-runner.ts");
    deps.spawnBackground("bun", [wrapperPath, deps.baseDir]);

    deps.stderr("[LearningActioner] Spawned wrapper to run analysis agent");
    return ok({ type: "silent" });
  },

  defaultDeps,
};
