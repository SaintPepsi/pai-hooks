/**
 * AlgorithmTracker Contract — Consolidated algorithm state tracking.
 *
 * Four responsibilities from PostToolUse events:
 * 1. Phase tracking: voice curls in Bash → phaseTransition()
 * 2. Criteria tracking: TaskCreate for ISC → criteriaAdd()
 * 3. Criteria updates: TaskUpdate status changes → criteriaUpdate()
 * 4. Agent tracking: Task tool for agent spawns → agentAdd()
 */

import { join } from "node:path";
import { fileExists, readJson } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { continueOk } from "@hooks/core/types/hook-outputs";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import type {
  AlgorithmCriterion,
  AlgorithmPhase,
  AlgorithmState,
} from "@hooks/lib/algorithm-state";
import {
  agentAdd,
  criteriaAdd,
  criteriaUpdate,
  effortLevelUpdate,
  phaseTransition,
  readState,
  writeState,
} from "@hooks/lib/algorithm-state";
import { setPhaseTab } from "@hooks/lib/tab-setter";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AlgorithmTrackerDeps {
  readState: typeof readState;
  writeState: typeof writeState;
  phaseTransition: typeof phaseTransition;
  criteriaAdd: typeof criteriaAdd;
  criteriaUpdate: typeof criteriaUpdate;
  agentAdd: typeof agentAdd;
  effortLevelUpdate: typeof effortLevelUpdate;
  setPhaseTab: typeof setPhaseTab;
  fileExists: (path: string) => boolean;
  readJson: <T = unknown>(path: string) => Result<T, PaiError>;
  fetch: typeof globalThis.fetch;
  baseDir: string;
  voiceId: string;
  stderr: (msg: string) => void;
}

// ─── Phase Detection ─────────────────────────────────────────────────────────

const PHASE_MAP: Record<string, AlgorithmPhase> = {
  "entering the observe phase": "OBSERVE",
  "entering the think phase": "THINK",
  "entering the plan phase": "PLAN",
  "entering the build phase": "BUILD",
  "entering the execute phase": "EXECUTE",
  "entering the verify phase": "VERIFY",
  "entering the verify phase.": "VERIFY",
  "entering the learn phase": "LEARN",
};

const ALGORITHM_ENTRY = "entering the pai algorithm";

export function detectPhaseFromBash(command: string): {
  phase: AlgorithmPhase | null;
  isAlgorithmEntry: boolean;
} {
  if (!command.includes("localhost:8888") || !command.includes("/notify")) {
    return { phase: null, isAlgorithmEntry: false };
  }

  const messageMatch = command.match(/"message"\s*:\s*"([^"]+)"/);
  if (!messageMatch) return { phase: null, isAlgorithmEntry: false };

  const message = messageMatch[1].toLowerCase();

  if (message.includes(ALGORITHM_ENTRY)) {
    return { phase: null, isAlgorithmEntry: true };
  }

  for (const [pattern, phase] of Object.entries(PHASE_MAP)) {
    if (message.includes(pattern)) {
      return { phase, isAlgorithmEntry: false };
    }
  }

  return { phase: null, isAlgorithmEntry: false };
}

// ─── Criteria Detection ──────────────────────────────────────────────────────

const CRITERION_PATTERNS = [
  /ISC-(C\d+):\s*(.+)/,
  /ISC-(A\d+):\s*(.+)/,
  /ISC-([\w]+-\d+):\s*(.+)/,
  /ISC-(A-[\w]+-\d+):\s*(.+)/,
  /^(C\d+):\s*(.+)/,
  /^(A\d+):\s*(.+)/,
];
const TASK_NUMBER = /Task\s+#(\d+)\s+created successfully/;

export function parseCriterion(text: string): { id: string; description: string } | null {
  for (const p of CRITERION_PATTERNS) {
    const m = text.match(p);
    if (m) return { id: m[1], description: m[2].trim() };
  }
  return null;
}

// ─── Session Activation ──────────────────────────────────────────────────────

function getSessionName(sid: string, deps: AlgorithmTrackerDeps): string {
  const snPath = join(deps.baseDir, "MEMORY", "STATE", "session-names.json");
  const result = deps.readJson<Record<string, string>>(snPath);
  if (result.ok && result.value[sid]) return result.value[sid];
  return sid.slice(0, 8);
}

function ensureSessionActive(sessionId: string, deps: AlgorithmTrackerDeps): void {
  const existing = deps.readState(sessionId);
  if (existing?.active) return;

  const now = Date.now();

  if (!existing) {
    deps.writeState({
      active: true,
      sessionId,
      taskDescription: getSessionName(sessionId, deps),
      currentPhase: "OBSERVE",
      phaseStartedAt: now,
      algorithmStartedAt: now,
      sla: "Standard",
      criteria: [],
      agents: [],
      capabilities: ["Task Tool"],
      phaseHistory: [{ phase: "OBSERVE", startedAt: now, criteriaCount: 0, agentCount: 0 }],
    } as AlgorithmState);
  } else {
    existing.active = true;
    delete existing.completedAt;
    delete existing.summary;
    deps.writeState(existing);
  }
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: AlgorithmTrackerDeps = {
  readState,
  writeState,
  phaseTransition,
  criteriaAdd,
  criteriaUpdate,
  agentAdd,
  effortLevelUpdate,
  setPhaseTab,
  fileExists,
  readJson,
  fetch: globalThis.fetch,
  baseDir: getPaiDir(),
  voiceId: process.env.PAI_VOICE_ID || "pNInz6obpgDQGcFmaJgB",
  stderr: defaultStderr,
};

export const AlgorithmTracker: SyncHookContract<
  ToolHookInput,
  ContinueOutput,
  AlgorithmTrackerDeps
> = {
  name: "AlgorithmTracker",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    return ["Bash", "TaskCreate", "TaskUpdate", "Task"].includes(input.tool_name);
  },

  execute(input: ToolHookInput, deps: AlgorithmTrackerDeps): Result<ContinueOutput, PaiError> {
    const { tool_name, tool_input, session_id } = input;
    const tool_result = (input as unknown as Record<string, unknown>).tool_result;
    if (!session_id) return ok(continueOk());

    // 1. Bash → Phase detection from voice curls
    if (tool_name === "Bash" && tool_input?.command) {
      const { phase, isAlgorithmEntry } = detectPhaseFromBash(tool_input.command as string);

      if (isAlgorithmEntry) {
        ensureSessionActive(session_id, deps);
        deps.stderr("[AlgorithmTracker] algorithm entry detected");
      }

      if (phase) {
        const preState = deps.readState(session_id);
        const wasCompleteOrLearned =
          preState &&
          (preState.currentPhase === "COMPLETE" ||
            preState.currentPhase === "LEARN" ||
            preState.currentPhase === "IDLE");
        const hadWork = preState && (preState.criteria.length > 0 || !!preState.summary);
        const isReworkTransition = phase === "OBSERVE" && wasCompleteOrLearned && hadWork;

        ensureSessionActive(session_id, deps);
        deps.phaseTransition(session_id, phase);

        if (isReworkTransition) {
          const postState = deps.readState(session_id);
          const reworkNum = postState?.reworkCount ?? 1;
          deps
            .fetch("http://localhost:8888/notify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                message: `Re-entering algorithm. Rework iteration ${reworkNum}.`,
                voice_id: deps.voiceId,
              }),
            })
            .catch((e) =>
              deps.stderr(`[AlgorithmTracker] rework notification error: ${String(e)}`),
            );
          deps.stderr(`[AlgorithmTracker] REWORK detected — iteration ${reworkNum}`);
        }

        deps.setPhaseTab(phase, session_id);
        deps.stderr(`[AlgorithmTracker] phase: ${phase}`);
      }
    }

    // 2. TaskCreate → Criteria tracking
    else if (tool_name === "TaskCreate") {
      let criterion: { id: string; description: string } | null = null;
      let taskNumber: string | undefined;

      if (tool_result) {
        const m = String(tool_result).match(TASK_NUMBER);
        if (m) taskNumber = m[1];
      }
      if (tool_input?.subject) criterion = parseCriterion(tool_input.subject as string);
      if (!criterion && tool_result) {
        const after = String(tool_result).match(/created successfully:\s*(.+)/);
        if (after) criterion = parseCriterion(after[1]);
      }

      if (criterion) {
        ensureSessionActive(session_id, deps);
        const state = deps.readState(session_id);
        const c: AlgorithmCriterion = {
          id: criterion.id,
          description: criterion.description,
          type: criterion.id.startsWith("A") ? "anti-criterion" : "criterion",
          status: "pending",
          createdInPhase: state?.currentPhase || "OBSERVE",
          ...(taskNumber && { taskId: taskNumber }),
        };
        deps.criteriaAdd(session_id, c);

        const updated = deps.readState(session_id);
        if (updated && updated.sla === "Standard") {
          const count = updated.criteria.length;
          let inferred: "Standard" | "Extended" | "Advanced" | "Deep" | "Comprehensive" | null =
            null;
          if (count >= 40) inferred = "Deep";
          else if (count >= 20) inferred = "Advanced";
          else if (count >= 12) inferred = "Extended";
          if (inferred) {
            deps.effortLevelUpdate(session_id, inferred);
            deps.stderr(
              `[AlgorithmTracker] effort level inferred: ${inferred} (${count} criteria)`,
            );
          }
        }
      }
    }

    // 3. TaskUpdate → Criteria status updates
    else if (tool_name === "TaskUpdate" && tool_input?.taskId && tool_input?.status) {
      const statusMap: Record<string, AlgorithmCriterion["status"]> = {
        pending: "pending",
        in_progress: "in_progress",
        completed: "completed",
        deleted: "failed",
      };
      const mapped = statusMap[tool_input.status as string];
      if (mapped) deps.criteriaUpdate(session_id, tool_input.taskId as string, mapped);
    }

    // 4. Task → Agent spawn tracking
    else if (tool_name === "Task" && tool_input) {
      const agentName = (tool_input.name || tool_input.description || "unnamed") as string;
      const agentType = (tool_input.subagent_type || "general-purpose") as string;
      const task = (tool_input.description ||
        (tool_input.prompt as string)?.slice(0, 80) ||
        "") as string;

      deps.agentAdd(session_id, { name: agentName, agentType, task });
      deps.stderr(`[AlgorithmTracker] agent spawned: ${agentName} (${agentType})`);
    }

    return ok(continueOk());
  },

  defaultDeps,
};
