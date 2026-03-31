/**
 * algorithm-state.ts — Single source of truth for algorithm state management.
 *
 * ALL state writes go through this module. No other code writes to algorithm
 * state files directly.
 *
 * Architecture:
 *   Per-session files: MEMORY/STATE/algorithms/{sessionId}.json
 *   One file per session. Multiple runs tracked via phaseHistory resets.
 *
 * Writers (1 hook, 1 handler):
 *   AlgorithmTracker (PostToolUse: Bash,TaskCreate,TaskUpdate,Task)
 *     → phaseTransition(), criteriaAdd(), criteriaUpdate(), agentAdd(), effortLevelUpdate()
 *     → Real-time effort level inference: upgrades from 'Standard' based on criteria count
 *       (>=12 → Extended, >=20 → Advanced, >=40 → Deep)
 *   AlgorithmEnrichment (Stop handler in StopOrchestrator)
 *     → algorithmEnd(), sweepStaleActive()
 *     → Multi-pattern regex extraction + heuristic fallback for effort level
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
  ensureDir,
  fileExists,
  readDir,
  readFile,
  readJson,
  removeFile,
  stat,
  writeFile,
} from "@hooks/core/adapters/fs";
import { getEnv } from "@hooks/core/adapters/process";
import type { PaiError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";

// ── Types ──

export type AlgorithmPhase =
  | "OBSERVE"
  | "THINK"
  | "PLAN"
  | "BUILD"
  | "EXECUTE"
  | "VERIFY"
  | "LEARN"
  | "IDLE"
  | "COMPLETE";

export interface AlgorithmCriterion {
  id: string;
  description: string;
  type: "criterion" | "anti-criterion";
  status: "pending" | "in_progress" | "completed" | "failed";
  evidence?: string;
  createdInPhase: AlgorithmPhase;
  taskId?: string;
}

export interface PhaseEntry {
  phase: AlgorithmPhase;
  startedAt: number;
  completedAt?: number;
  criteriaCount: number;
  agentCount: number;
  /** True if this phase visit is part of a rework cycle */
  isRework?: boolean;
  /** Which rework iteration (0 = initial run, 1+ = rework) */
  reworkIteration?: number;
}

/** Archive of a completed algorithm cycle (preserved during rework) */
export interface ReworkCycle {
  iteration: number;
  startedAt: number;
  completedAt: number;
  fromPhase: AlgorithmPhase;
  toPhase: AlgorithmPhase;
  criteria: AlgorithmCriterion[];
  summary?: string;
  effortLevel: string;
  phaseHistory: PhaseEntry[];
}

export interface AlgorithmAgent {
  name: string;
  agentType: string;
  status: "active" | "completed" | "failed" | string;
  task?: string;
  criteriaIds?: string[];
  phase?: AlgorithmPhase | string;
}

export interface AlgorithmState {
  active: boolean;
  sessionId: string;
  taskDescription: string;
  currentPhase: AlgorithmPhase;
  phaseStartedAt: number;
  algorithmStartedAt: number;
  sla:
    | "Instant"
    | "Fast"
    | "Standard"
    | "Extended"
    | "Advanced"
    | "Deep"
    | "Comprehensive"
    | "Loop";
  /** Canonical field name — same value as sla, preferred by UI */
  effortLevel?:
    | "Instant"
    | "Fast"
    | "Standard"
    | "Extended"
    | "Advanced"
    | "Deep"
    | "Comprehensive"
    | "Loop";
  criteria: AlgorithmCriterion[];
  agents: AlgorithmAgent[];
  capabilities: string[];
  prdPath?: string;
  phaseHistory: PhaseEntry[];
  qualityGate?: {
    count: boolean;
    length: boolean;
    state: boolean;
    testable: boolean;
    anti: boolean;
    open: boolean;
  };
  currentAction?: string;
  completedAt?: number;
  summary?: string;
  abandoned?: boolean;
  /** Number of times this session re-entered the algorithm after completion */
  reworkCount?: number;
  /** True when currently in a rework cycle (vs initial run) */
  isRework?: boolean;
  /** Archive of each completed algorithm cycle */
  reworkHistory?: ReworkCycle[];
  /** History of session name changes on rework (for dashboard display) */
  previousNames?: Array<{ name: string; changedAt: string }>;
  /** Loop mode: true when this state represents a Loop runner session */
  loopMode?: boolean;
  /** Loop mode: current iteration number */
  loopIteration?: number;
  /** Loop mode: max allowed iterations */
  loopMaxIterations?: number;
  /** Loop mode: PRD identifier */
  loopPrdId?: string;
  /** Loop mode: absolute path to PRD file */
  loopPrdPath?: string;
  /** Loop mode: per-iteration progress history */
  loopHistory?: Array<{
    iteration: number;
    startedAt: number;
    completedAt: number;
    criteriaPassing: number;
    criteriaTotal: number;
    sdkSessionId?: string;
  }>;
  /** Parallel agents: number of concurrent agents configured via -a flag */
  parallelAgents?: number;
  /** Execution mode: distinguishes loop/interactive/standard for dashboard display */
  mode?: "loop" | "interactive" | "standard";
}

// ── Deps ──

export interface AlgorithmStateDeps {
  readFile: (path: string) => Result<string, PaiError>;
  fileExists: (path: string) => boolean;
  writeFile: (path: string, content: string) => Result<void, PaiError>;
  ensureDir: (path: string) => Result<void, PaiError>;
  readJson: <T>(path: string) => Result<T, PaiError>;
  readDir: (path: string) => Result<string[], PaiError>;
  removeFile: (path: string) => Result<void, PaiError>;
  stat: (path: string) => Result<{ mtimeMs: number; isDirectory(): boolean }, PaiError>;
  stderr: (msg: string) => void;
  baseDir: string;
}

function resolveBaseDir(): string {
  const envResult = getEnv("PAI_DIR");
  if (envResult.ok) return envResult.value;
  const homeResult = getEnv("HOME");
  if (homeResult.ok) return join(homeResult.value, ".claude");
  return join(homedir(), ".claude");
}

export const defaultAlgorithmStateDeps: AlgorithmStateDeps = {
  readFile,
  fileExists,
  writeFile,
  ensureDir,
  readJson,
  readDir,
  removeFile,
  stat,
  stderr: (msg: string) => process.stderr.write(`${msg}\n`),
  baseDir: resolveBaseDir(),
};

// ── Paths ──

function algorithmsDir(deps: AlgorithmStateDeps): string {
  return join(deps.baseDir, "MEMORY", "STATE", "algorithms");
}

function ensureAlgorithmsDir(deps: AlgorithmStateDeps): void {
  const dir = algorithmsDir(deps);
  if (!deps.fileExists(dir)) deps.ensureDir(dir);
}

// ── Read / Write ──

export function readState(
  sessionId: string,
  deps: AlgorithmStateDeps = defaultAlgorithmStateDeps,
): AlgorithmState | null {
  const file = join(algorithmsDir(deps), `${sessionId}.json`);
  if (!deps.fileExists(file)) return null;
  const result = deps.readFile(file);
  if (!result.ok) return null;
  const raw = result.value.trim();
  if (!raw || raw === "{}") return null;
  const jsonResult = deps.readJson<AlgorithmState>(file);
  if (!jsonResult.ok) return null;
  return jsonResult.value;
}

export function writeState(
  state: AlgorithmState,
  deps: AlgorithmStateDeps = defaultAlgorithmStateDeps,
): void {
  ensureAlgorithmsDir(deps);
  // Keep effortLevel in sync with sla — UI reads effortLevel preferentially
  state.effortLevel = state.sla;
  deps.writeFile(
    join(algorithmsDir(deps), `${state.sessionId}.json`),
    JSON.stringify(state, null, 2),
  );
}

// ── Public API ──

/**
 * Called when a phase transition curl is detected (e.g., "Entering the Think phase").
 */
export function phaseTransition(
  sessionId: string,
  phase: AlgorithmPhase,
  deps: AlgorithmStateDeps = defaultAlgorithmStateDeps,
): void {
  const now = Date.now();
  let state = readState(sessionId, deps);

  if (!state) {
    // No state yet — create one (algorithm entry curl may have been missed)
    state = {
      active: true,
      sessionId,
      taskDescription: "Algorithm run",
      currentPhase: phase,
      phaseStartedAt: now,
      algorithmStartedAt: now,
      sla: "Standard",
      criteria: [],
      agents: [],
      capabilities: ["Task Tool"],
      phaseHistory: [{ phase, startedAt: now, criteriaCount: 0, agentCount: 0 }],
    };
    writeState(state, deps);
    return;
  }

  // New algorithm run within same session?
  const isNewRun =
    phase === "OBSERVE" &&
    (state.currentPhase === "LEARN" ||
      state.currentPhase === "COMPLETE" ||
      state.currentPhase === "IDLE");

  if (isNewRun) {
    // Detect rework: session had previous work (criteria or summary = evidence of completed run)
    const hasPreviousWork = state.criteria.length > 0 || !!state.summary;

    if (hasPreviousWork) {
      // Archive current cycle into reworkHistory
      const cycle: ReworkCycle = {
        iteration: state.reworkCount ?? 0,
        startedAt: state.algorithmStartedAt,
        completedAt: state.completedAt || now,
        fromPhase: state.currentPhase,
        toPhase: phase,
        criteria: [...state.criteria],
        summary: state.summary,
        effortLevel: state.sla,
        phaseHistory: [...state.phaseHistory],
      };
      if (!state.reworkHistory) state.reworkHistory = [];
      state.reworkHistory.push(cycle);
      state.reworkCount = (state.reworkCount ?? 0) + 1;
      state.isRework = true;
    }

    state.active = true;
    state.currentPhase = phase;
    state.phaseStartedAt = now;
    state.algorithmStartedAt = now;
    state.criteria = [];
    state.capabilities = ["Task Tool"];
    const reworkIter = state.reworkCount ?? 0;
    state.phaseHistory = [
      {
        phase,
        startedAt: now,
        criteriaCount: 0,
        agentCount: 0,
        isRework: reworkIter > 0,
        reworkIteration: reworkIter,
      },
    ];
    delete state.completedAt;
    delete state.summary;
    delete state.qualityGate;
    writeState(state, deps);
    return;
  }

  // Normal phase transition — close previous, open new
  if (state.phaseHistory.length > 0) {
    const last = state.phaseHistory[state.phaseHistory.length - 1];
    if (!last.completedAt) last.completedAt = now;
  }

  const reworkIter = state.reworkCount ?? 0;
  state.phaseHistory.push({
    phase,
    startedAt: now,
    criteriaCount: state.criteria.length,
    agentCount: state.agents.filter((a) => a.status === "active").length,
    ...(reworkIter > 0 && { isRework: true, reworkIteration: reworkIter }),
  });

  state.active = true;
  state.currentPhase = phase;
  state.phaseStartedAt = now;

  // LEARN sets completedAt for grace period display but stays active
  // until the Stop handler calls algorithmEnd()
  if (phase === "LEARN") {
    state.completedAt = now;
  }

  writeState(state, deps);
}

/**
 * Called when TaskCreate produces an ISC criterion.
 * Also handles session reactivation — ISC criteria arriving for a completed
 * session is a definitive signal of a new algorithm run.
 */
export function criteriaAdd(
  sessionId: string,
  criterion: AlgorithmCriterion,
  deps: AlgorithmStateDeps = defaultAlgorithmStateDeps,
): void {
  let state = readState(sessionId, deps);

  // Create state if none exists — ISC criteria in a new session should not be dropped
  if (!state) {
    const now = Date.now();
    state = {
      active: true,
      sessionId,
      taskDescription: "Algorithm run",
      currentPhase: "OBSERVE" as AlgorithmPhase,
      phaseStartedAt: now,
      algorithmStartedAt: now,
      sla: "Standard" as AlgorithmState["sla"],
      criteria: [],
      agents: [],
      capabilities: ["Task Tool"],
      phaseHistory: [
        { phase: "OBSERVE" as AlgorithmPhase, startedAt: now, criteriaCount: 0, agentCount: 0 },
      ],
    };
  }

  // Reactivate completed session — new ISC criteria = new algorithm run
  if (!state.active) {
    const now = Date.now();
    const hasPreviousWork = state.criteria.length > 0 || !!state.summary;

    // Archive previous cycle if it had work (rework detection)
    if (hasPreviousWork) {
      const cycle: ReworkCycle = {
        iteration: state.reworkCount ?? 0,
        startedAt: state.algorithmStartedAt,
        completedAt: state.completedAt || now,
        fromPhase: state.currentPhase,
        toPhase: "OBSERVE",
        criteria: [...state.criteria],
        summary: state.summary,
        effortLevel: state.sla,
        phaseHistory: [...state.phaseHistory],
      };
      if (!state.reworkHistory) state.reworkHistory = [];
      state.reworkHistory.push(cycle);
      state.reworkCount = (state.reworkCount ?? 0) + 1;
      state.isRework = true;
    }

    const reworkIter = state.reworkCount ?? 0;
    state = {
      ...state,
      active: true,
      currentPhase: "OBSERVE" as AlgorithmPhase,
      phaseStartedAt: now,
      algorithmStartedAt: now,
      sla: "Standard" as AlgorithmState["sla"],
      criteria: [],
      capabilities: ["Task Tool"],
      phaseHistory: [
        {
          phase: "OBSERVE" as AlgorithmPhase,
          startedAt: now,
          criteriaCount: 0,
          agentCount: 0,
          isRework: reworkIter > 0,
          reworkIteration: reworkIter,
        },
      ],
      agents: [],
    };
    delete state.completedAt;
    delete state.summary;
    delete state.qualityGate;
  }

  // Don't add duplicates
  if (state.criteria.some((c) => c.id === criterion.id)) return;

  state.criteria.push(criterion);
  writeState(state, deps);
}

/**
 * Called when TaskUpdate changes a criterion's status.
 */
export function criteriaUpdate(
  sessionId: string,
  taskId: string,
  status: AlgorithmCriterion["status"],
  deps: AlgorithmStateDeps = defaultAlgorithmStateDeps,
): void {
  const state = readState(sessionId, deps);
  if (!state) return;

  const criterion = state.criteria.find((c) => c.taskId === taskId);
  if (!criterion) return;

  criterion.status = status;
  writeState(state, deps);
}

/**
 * Called when the Algorithm's OBSERVE phase selects an effort level.
 * Detected in real-time by AlgorithmTracker from response text.
 */
export function effortLevelUpdate(
  sessionId: string,
  level: AlgorithmState["sla"],
  deps: AlgorithmStateDeps = defaultAlgorithmStateDeps,
): void {
  const state = readState(sessionId, deps);
  if (!state) return;

  state.sla = level;
  writeState(state, deps);
}

/**
 * Called when a Task tool spawns an agent.
 */
export function agentAdd(
  sessionId: string,
  agent: { name: string; agentType: string; task?: string; criteriaIds?: string[] },
  deps: AlgorithmStateDeps = defaultAlgorithmStateDeps,
): void {
  const state = readState(sessionId, deps);
  if (!state) return;

  // Don't add duplicates
  if (state.agents.some((a) => a.name === agent.name)) return;

  const entry: AlgorithmAgent = {
    name: agent.name,
    agentType: agent.agentType,
    status: "active",
    task: agent.task,
    phase: state.currentPhase,
  };
  if (agent.criteriaIds) entry.criteriaIds = agent.criteriaIds;
  state.agents.push(entry);
  writeState(state, deps);
}

/**
 * Called by Stop handler after response is complete.
 * Enriches state with data extracted from the full transcript.
 *
 * Two modes:
 * - isAlgorithmResponse=true: Enrich with extracted data, mark terminal if LEARN/COMPLETE
 * - isAlgorithmResponse=false: Deactivate optimistically-activated sessions
 */
export function algorithmEnd(
  sessionId: string,
  enrichment: {
    taskDescription?: string;
    summary?: string;
    sla?: AlgorithmState["sla"];
    capabilities?: string[];
    qualityGate?: AlgorithmState["qualityGate"];
    criteria?: AlgorithmCriterion[];
    isAlgorithmResponse: boolean;
  },
  deps: AlgorithmStateDeps = defaultAlgorithmStateDeps,
): void {
  let state = readState(sessionId, deps);

  // Non-algorithm response: deactivate if it was optimistically activated
  if (!enrichment.isAlgorithmResponse) {
    if (state?.active && state.phaseHistory.length <= 1 && state.criteria.length === 0) {
      // Session was activated by SessionReactivator but response wasn't algorithm format.
      // Deactivate to prevent stale active sessions.
      state.active = false;
      state.currentPhase = "COMPLETE";
      state.completedAt = Date.now();
      writeState(state, deps);
    }
    return;
  }

  // No state file yet — create one
  if (!state) {
    state = {
      active: true,
      sessionId,
      taskDescription: enrichment.taskDescription || "Algorithm run",
      currentPhase: "OBSERVE",
      phaseStartedAt: Date.now(),
      algorithmStartedAt: Date.now(),
      sla: enrichment.sla || "Standard",
      criteria: [],
      agents: [],
      capabilities: ["Task Tool"],
      phaseHistory: [],
    };
  }

  // Enrich with extracted data
  if (enrichment.taskDescription) {
    state.taskDescription = enrichment.taskDescription;
    state.currentAction = enrichment.taskDescription;
  }
  if (enrichment.summary) state.summary = enrichment.summary;
  if (enrichment.sla) state.sla = enrichment.sla;
  if (enrichment.capabilities && enrichment.capabilities.length > 0) {
    state.capabilities = enrichment.capabilities;
  }
  if (enrichment.qualityGate) state.qualityGate = enrichment.qualityGate;

  // Merge criteria from transcript (catches any missed by real-time tracker)
  if (enrichment.criteria && enrichment.criteria.length > 0) {
    for (const c of enrichment.criteria) {
      const existing = state.criteria.find((ec) => ec.id === c.id);
      if (existing) {
        const order = ["pending", "in_progress", "completed", "failed"];
        if (order.indexOf(c.status) > order.indexOf(existing.status)) {
          existing.status = c.status;
          if (c.evidence) existing.evidence = c.evidence;
        }
      } else {
        state.criteria.push(c);
      }
    }
  }

  // Terminal detection — response is done when phase reached LEARN or COMPLETE.
  // Summary extraction alone is NOT sufficient — during compaction, StopOrchestrator
  // fires with a partial transcript that may contain voice lines from earlier phases.
  // Only phase-based detection is reliable across compaction boundaries.
  const isTerminal = state.currentPhase === "LEARN" || state.currentPhase === "COMPLETE";
  if (isTerminal) {
    state.active = false;
    state.currentPhase = "COMPLETE";
    state.completedAt = state.completedAt || Date.now();
  }

  writeState(state, deps);
}

/**
 * Sweep all algorithm state files and mark stale active sessions as completed.
 * Called after every response by the StopOrchestrator handler.
 *
 * Phase-aware thresholds protect long-running work:
 * - BUILD/EXECUTE: 60min (art generation, multi-agent swarms, long processes)
 * - THINK/PLAN/VERIFY: 30min (extended reasoning, complex verification)
 * - OBSERVE/LEARN/IDLE/other: 15min (should complete quickly)
 *
 * File mtime is the staleness signal — updated by every tool call hook.
 * Loop items (PRDs) are NOT affected — they use a separate data store.
 */
const STALE_THRESHOLDS_MS: Record<string, number> = {
  BUILD: 60 * 60 * 1000, // 60 min
  EXECUTE: 60 * 60 * 1000, // 60 min
  THINK: 30 * 60 * 1000, // 30 min
  PLAN: 30 * 60 * 1000, // 30 min
  VERIFY: 30 * 60 * 1000, // 30 min
};
const DEFAULT_STALE_MS = 15 * 60 * 1000; // 15 min for OBSERVE, LEARN, IDLE, etc.

const DELETE_AGE_MS = 24 * 60 * 60 * 1000; // 24hr: completed files older than this get deleted

export function sweepStaleActive(
  currentSessionId: string,
  deps: AlgorithmStateDeps = defaultAlgorithmStateDeps,
): void {
  ensureAlgorithmsDir(deps);
  const now = Date.now();
  const dirResult = deps.readDir(algorithmsDir(deps));
  if (!dirResult.ok) return;
  const files = dirResult.value.filter((f: string) => f.endsWith(".json"));
  const liveSessionIds = new Set<string>();

  for (const file of files) {
    const sid = file.replace(".json", "");
    if (sid === currentSessionId) continue; // Skip current session — handled by algorithmEnd

    const filepath = join(algorithmsDir(deps), file);
    const statResult = deps.stat(filepath);
    if (!statResult.ok) continue;
    const mtime = statResult.value.mtimeMs;
    const age = now - mtime;

    const state = readState(sid, deps);
    if (!state) continue;

    // Delete completed files older than 24 hours — they clutter the directory
    if (!state.active && age > DELETE_AGE_MS) {
      deps.removeFile(filepath);
      deps.stderr(`[sweep] deleted ${sid} (completed, age ${Math.round(age / 3600000)}h)`);
      continue;
    }

    liveSessionIds.add(sid);

    // Quick skip: anything modified in last 15 min is never stale
    if (age < DEFAULT_STALE_MS) continue;

    if (!state.active) continue;

    // Phase-aware threshold
    const threshold = STALE_THRESHOLDS_MS[state.currentPhase] || DEFAULT_STALE_MS;
    if (age < threshold) continue;

    // Stale active session — mark completed
    state.active = false;
    state.currentPhase = "COMPLETE";
    state.completedAt = state.completedAt || now;
    writeState(state, deps);
    deps.stderr(
      `[sweep] deactivated ${sid} (phase was ${state.currentPhase}, age ${Math.round(age / 60000)}min)`,
    );
  }

}

/**
 * Called by POST /api/algorithm/abandon
 */
export function algorithmAbandon(
  sessionId: string,
  deps: AlgorithmStateDeps = defaultAlgorithmStateDeps,
): boolean {
  const state = readState(sessionId, deps);
  if (!state) return false;

  state.abandoned = true;
  state.active = false;
  state.completedAt = state.completedAt || Date.now();
  writeState(state, deps);
  return true;
}
