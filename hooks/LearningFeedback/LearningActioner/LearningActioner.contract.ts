/**
 * LearningActioner Contract — Spawn background agent to analyze learnings.
 *
 * At SessionEnd, checks if learning sources exist. If so, spawns a bun wrapper
 * (learning-agent-runner.ts) that runs claude synchronously and handles cleanup
 * deterministically in code, not via prompt instructions.
 *
 * Mitigations:
 * - Lock file prevents concurrent agents (.analyzing with 45-min stale timeout)
 * - Credit accumulation gating replaces fixed cooldown (threshold: 10, based on 5h usage)
 * - Wrapper cleans up lock in finally block (no prompt-based cleanup)
 * - Lock persists during child claude's SessionEnd hooks, preventing recursion
 * - Agent reads pending/ proposals to avoid duplicates
 * - max-turns (25) and model (opus) cap agent cost
 */

import type { SyncHookContract } from "@hooks/core/contract";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import type { SilentOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import {
  fileExists,
  readDir,
  readJson,
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
  readDir: (path: string, opts?: { withFileTypes: true }) => Result<unknown[], PaiError>;
  readJson: <T = unknown>(path: string) => Result<T, PaiError>;
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

const LOCK_STALE_MS = 45 * 60 * 1000; // 45 minutes (Opus agents with 25 turns, 30-min hard timeout + 15-min buffer per T3 threat mitigation)
const SPAWN_CREDIT_THRESHOLD = 10;
const FIVE_HOUR_WINDOW_SEC = 5 * 3600;

// ─── Credit Accumulation Types ──────────────────────────────────────────────

interface UsageCache {
  five_hour?: { utilization: number; resets_at: string };
}

interface CreditState {
  credit: number;
  last_updated: string;
}

interface CreditResult {
  shouldSpawn: boolean;
  newCredit: number;
  reason: string;
}

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
  return `You are a PAI system analyst. Your job is to analyze learning signals and produce
high-quality improvement proposals backed by evidence and calibrated confidence scores.

WORKING DIRECTORY: ${baseDir}

═══ SECTION 1: LEARNING SOURCES ═══════════════════════════════════════════════

Read the following learning sources (all paths relative to ${baseDir}):
1. MEMORY/LEARNING/REFLECTIONS/algorithm-reflections.jsonl — Algorithm reflections (last 50 lines)
2. MEMORY/LEARNING/ALGORITHM/ — Recent algorithm learning .md files (last 30 days)
3. MEMORY/LEARNING/SYSTEM/ — Recent system learning .md files (last 30 days)
4. MEMORY/LEARNING/SIGNALS/ratings.jsonl — Sentiment ratings (last 50 lines)
5. MEMORY/LEARNING/SIGNALS/quality-violations.jsonl — SOLID violations (last 50 lines)
6. MEMORY/LEARNING/QUALITY/ — Session quality reports

═══ SECTION 2: SYSTEM STATE ════════════════════════════════════════════════════

Before proposing ANY change, understand what already exists. Read these files:
7. CLAUDE.md — Current system configuration, modes, and rules
8. PAI/USER/AISTEERINGRULES.md — User-specific steering rules (the most common proposal target)
9. PAI/SYSTEM/AISTEERINGRULES.md — System-level steering rules
10. settings.json — Current identity and configuration
11. skills/skill-index.json — Current skill registry (skim names and descriptions ONLY — do not read full file)

For hook-related proposals: run \`ls pai-hooks/contracts/*.ts\` to see available contracts.
Only read the SPECIFIC contract file relevant to your proposal — do NOT read all contracts.

DO NOT propose adding a rule that already exists. DO NOT propose a hook that duplicates existing behavior.

SANDBOX NOTE: You are running inside Claude Code with full hook infrastructure.
SecurityValidator enforces path-level access control on every tool call.
You MUST NOT modify any file outside MEMORY/LEARNING/PROPOSALS/pending/.
You MUST NOT run destructive commands (recursive deletes, force pushes, etc.).

═══ SECTION 3: FEEDBACK CORPUS ════════════════════════════════════════════════

Study the historical proposal decisions to calibrate your judgment.

CONTEXT BUDGET: Read at most 10 most recent proposals from each resolved directory.
Skip any proposal where decision_rationale contains "Backfilled" — these have no useful feedback.
Prioritize proposals with substantive rationale and confidence scores.

12. MEMORY/LEARNING/PROPOSALS/applied/ — Read up to 10 most recent. Look for decision_rationale and implementation_notes.
13. MEMORY/LEARNING/PROPOSALS/rejected/ — Read up to 10 most recent. CRITICAL — learn what NOT to propose.
14. MEMORY/LEARNING/PROPOSALS/deferred/ — Read up to 10 most recent. Understand "not yet" vs "not this".
15. MEMORY/LEARNING/PROPOSALS/pending/ — Read ALL. DO NOT duplicate.

Before writing any proposals, study the feedback corpus:

APPLIED proposals tell you what Ian values:
- What categories get accepted? What priority levels?
- What writing style and depth do accepted proposals have?
- How do successful proposals frame their rationale?
- Read the confidence.human_score and confidence.calibration_delta fields to understand scoring accuracy.

REJECTED proposals tell you what to avoid:
- What makes a proposal not worth implementing?
- What categories or approaches get rejected?
- Are there patterns in the decision_rationale?

DEFERRED proposals tell you what needs more work:
- What's promising but not ready?
- What additional context or refinement would help?

For APPLIED proposals that have implementation_notes, run \`git log --oneline -5 -- <file>\` on mentioned
files to see what the actual diff looked like vs what was proposed.

Calibrate your proposals against this corpus. A proposal that resembles rejected ones should not be written.
Focus on proposals with substantive decision_rationale. Ignore patterns from backfilled entries.

═══ SECTION 4: RECENT WORK CONTEXT ═══════════════════════════════════════════

16. Read the 5 most recent directories in MEMORY/WORK/ — check their PRD.md files for title, phase, and criteria.
    This tells you what Ian has been working on recently, so proposals can be timely and relevant.

═══ SECTION 5: PROPOSAL FORMAT ════════════════════════════════════════════════

Write proposals to: ${baseDir}/MEMORY/LEARNING/PROPOSALS/pending/

Filename format: {YYYYMMDD}-{HHMMSS}-{slug}.md
Slug: title lowercased, special chars stripped, spaces to hyphens, max 40 chars.

Each proposal MUST use this exact format:

---
id: PROP-{YYYYMMDD}-{N}
created: {ISO timestamp}
source_learnings:
  - {relative path to learning file 1}
  - {relative path to learning file 2}
status: pending
priority: low | medium | high
category: steering-rule | memory | hook | skill | workflow | token-efficiency
confidence:
  agent_score: {0-100}
  agent_reasoning: |
    {Why you scored this confidence level. Reference:
    - Evidence strength: how many independent signals, over what timeframe
    - System fit: does this complement or conflict with existing rules/hooks
    - Specificity: is the change concrete and implementation-ready
    - Risk: what could go wrong, how reversible
    - Track record: similarity to previously accepted/rejected proposals}
  will_solve: |
    {What problem this addresses and the expected impact}
  could_cause: |
    {Potential side effects, risks, or concerns}
  similar_to_applied: |
    {Reference specific applied proposals this resembles, if any, with PROP-ID}
  differs_from_rejected: |
    {Reference specific rejected proposals and explain why this is different}
---

# Proposal: {Title}

## What was learned
{Detailed summary of the pattern detected. Include specific dates, file paths,
signal values, and quotes from learning sources. Do not be vague.}

## Proposed change
**Target file:** {exact path relative to ${baseDir}}
**Change type:** append | edit | create

### Content to add/change:
{The EXACT content to be added or changed, ready to apply verbatim.
For steering rules: match the existing format in PAI/USER/AISTEERINGRULES.md.
For hooks: describe the contract name, event, accepts filter, and execute logic.
For skills: describe the SKILL.md structure.}

## Rationale
{Evidence-based reasoning linking learning sources to the proposed change.
Include timestamps, file paths, and direct quotes from sources.}

---

═══ GUIDELINES ═════════════════════════════════════════════════════════════════

Quality over quantity. Write 0-3 proposals per run. Zero is fine if nothing is actionable.

Think deeply before writing. Read the target file before proposing a change to it.
Verify your proposal doesn't duplicate an existing rule, hook, or skill.

A GOOD proposal:
- Has 3+ independent signals supporting it
- References specific learning sources with dates
- Includes exact implementation-ready content
- Has a confidence score backed by reasoning
- Acknowledges risks and alternatives

A BAD proposal (do not write these):
- Has vague "improve X" language without specifics
- Proposes something already covered by existing rules
- Has only 1 signal (could be noise, not pattern)
- Scores high confidence without strong evidence
- Doesn't read the target file before proposing changes

Valid categories:
- steering-rule: New or modified AI steering rule in PAI/USER/AISTEERINGRULES.md
- memory: Update to auto-memory or wisdom frames
- hook: Suggest a hook modification (describe contract changes)
- skill: Suggest a skill improvement
- workflow: Suggest a workflow or algorithm change
- token-efficiency: Suggest a way to reduce token usage`;
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

// ─── Credit Accumulation ────────────────────────────────────────────────────

/**
 * Project current 5h usage to end of window.
 * Uses same formula as statusline-helpers.ts projectUsage().
 */
function projectFiveHourUsage(utilization: number, resetsAt: string): number | null {
  const resetDate = new Date(resetsAt);
  if (isNaN(resetDate.getTime())) return null;
  const remainingSec = Math.max(0, (resetDate.getTime() - Date.now()) / 1000);
  const elapsedSec = FIVE_HOUR_WINDOW_SEC - remainingSec;
  if (elapsedSec < 300) return null; // Not enough data to project
  return Math.round(utilization * (FIVE_HOUR_WINDOW_SEC / elapsedSec));
}

/**
 * Read current credit, accumulate based on usage, check if spawn threshold met.
 * Returns shouldSpawn, the new credit value, and a reason string for logging.
 *
 * newCredit of -1 means projection blocked — don't persist anything.
 */
export function evaluateCredit(
  baseDir: string,
  deps: LearningActionerDeps,
): CreditResult {
  const usagePath = join(baseDir, "MEMORY/STATE/usage-cache.json");
  const creditPath = join(baseDir, "MEMORY/STATE/learning-agent-credit.json");

  // Read usage cache
  const usageResult = deps.readJson<UsageCache>(usagePath);
  const utilization = usageResult.ok ? (usageResult.value.five_hour?.utilization ?? 0) : 0;
  const resetsAt = usageResult.ok ? (usageResult.value.five_hour?.resets_at ?? "") : "";

  // Projection gate: if projected 5h usage >= 100%, hard block
  if (resetsAt) {
    const projected = projectFiveHourUsage(utilization, resetsAt);
    if (projected !== null && projected >= 100) {
      return { shouldSpawn: false, newCredit: -1, reason: `projected 5h usage ${projected}% >= 100%` };
    }
  }

  // Read current credit
  const creditResult = deps.readJson<CreditState>(creditPath);
  const currentCredit = creditResult.ok ? creditResult.value.credit : 0;

  // Accumulate: credit += (100 - utilization) / 100
  const increment = (100 - utilization) / 100;
  const newCredit = currentCredit + increment;

  if (newCredit >= SPAWN_CREDIT_THRESHOLD) {
    return { shouldSpawn: true, newCredit: 0, reason: `credit ${newCredit.toFixed(2)} >= ${SPAWN_CREDIT_THRESHOLD} (reset to 0)` };
  }

  return { shouldSpawn: false, newCredit, reason: `credit ${newCredit.toFixed(2)} < ${SPAWN_CREDIT_THRESHOLD} (+${increment.toFixed(2)} at ${utilization}% usage)` };
}

// ─── Contract ────────────────────────────────────────────────────────────────

const BASE_DIR = process.env.PAI_DIR || join(process.env.HOME!, ".claude");

const defaultDeps: LearningActionerDeps = {
  fileExists,
  readDir,
  readJson,
  writeFile,
  removeFile,
  ensureDir,
  stat,
  spawnBackground,
  getISOTimestamp,
  baseDir: BASE_DIR,
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const LearningActioner: SyncHookContract<
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

    // Credit accumulation gating (replaces fixed 6h cooldown)
    const creditResult = evaluateCredit(deps.baseDir, deps);
    const creditPath = join(deps.baseDir, "MEMORY/STATE/learning-agent-credit.json");

    // Always persist the new credit (even if we don't spawn), unless projection blocked
    if (creditResult.newCredit >= 0) {
      deps.writeFile(
        creditPath,
        JSON.stringify({ credit: creditResult.newCredit, last_updated: deps.getISOTimestamp() }, null, 2),
      );
    }

    if (!creditResult.shouldSpawn) {
      deps.stderr(`[LearningActioner] ${creditResult.reason}, skipping`);
      return ok({ type: "silent" });
    }

    deps.stderr(`[LearningActioner] ${creditResult.reason}, spawning agent`);

    // Check if any learning sources exist
    if (!hasLearningSources(deps.baseDir, deps)) {
      deps.stderr("[LearningActioner] No learning sources found, skipping");
      return ok({ type: "silent" });
    }

    // Ensure proposals directories exist
    for (const sub of ["pending", "applied", "rejected", "deferred"]) {
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
