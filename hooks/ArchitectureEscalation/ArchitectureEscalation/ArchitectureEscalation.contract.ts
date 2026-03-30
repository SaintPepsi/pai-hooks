/**
 * ArchitectureEscalation Contract — Pure business logic, no I/O.
 *
 * Tracks failed fix attempts per ISC criterion. After 3 failed attempts,
 * injects a warning. After 5, recommends stopping the current approach.
 *
 * Pattern from obra/superpowers systematic-debugging skill Phase 4.5.
 */

import { dirname, join } from "node:path";
import { ensureDir, fileExists, readJson, writeJson } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { continueOk } from "@hooks/core/types/hook-outputs";
import { getPaiDir } from "@hooks/lib/paths";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";

type FsReadJson = <T = unknown>(path: string) => Result<T, PaiError>;
type FsWriteJson = (path: string, data: unknown) => Result<void, PaiError>;
type FsEnsureDir = (path: string) => Result<void, PaiError>;
type FsFileExists = (path: string) => boolean;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CriterionRecord {
  inProgressCount: number;
  lastSeenAt: number;
}

export interface EscalationState {
  sessionId: string;
  criteria: Record<string, CriterionRecord>;
}

export interface ArchEscalationDeps {
  getPaiDir: () => string;
  now: () => number;
  stderr: (msg: string) => void;
  fileExists: FsFileExists;
  readJson: FsReadJson;
  writeJson: FsWriteJson;
  ensureDir: FsEnsureDir;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const WARN_THRESHOLD = 3;
export const STOP_THRESHOLD = 5;

// ─── State Management ────────────────────────────────────────────────────────

export function getStatePath(sessionId: string, deps: ArchEscalationDeps): string {
  return join(deps.getPaiDir(), "MEMORY", "STATE", `arch-escalation-${sessionId}.json`);
}

export function loadState(sessionId: string, deps: ArchEscalationDeps): EscalationState {
  const path = getStatePath(sessionId, deps);
  if (!deps.fileExists(path)) {
    return { sessionId, criteria: {} };
  }
  const result = deps.readJson<EscalationState>(path);
  if (!result.ok) {
    return { sessionId, criteria: {} };
  }
  return result.value;
}

export function saveState(state: EscalationState, deps: ArchEscalationDeps): void {
  const path = getStatePath(state.sessionId, deps);
  deps.ensureDir(dirname(path));
  const result = deps.writeJson(path, state);
  if (!result.ok) {
    deps.stderr(`[ArchEscalation] Failed to save state: ${result.error.message}`);
  }
}

// ─── Warning Messages ────────────────────────────────────────────────────────

export function buildWarningMessage(criterionId: string, failedAttempts: number): string {
  if (failedAttempts >= STOP_THRESHOLD) {
    return (
      `🚨 ARCHITECTURE ESCALATION — STOP CURRENT APPROACH\n` +
      `Criterion ${criterionId} has failed ${failedAttempts} times.\n` +
      `This strongly indicates a fundamental architectural problem, not a fixable bug.\n` +
      `\n` +
      `RECOMMENDED ACTIONS:\n` +
      `1. Stop retrying the current approach — it is not working\n` +
      `2. Invoke FirstPrinciples skill to decompose the root cause\n` +
      `3. Invoke Council skill for multi-perspective architectural debate\n` +
      `4. Consider a fundamentally different design approach\n` +
      `5. Communicate to the user that a rethink is needed\n` +
      `\n` +
      `Do NOT make another targeted fix attempt on ${criterionId}.`
    );
  }

  return (
    `⚠️  ARCHITECTURE ESCALATION WARNING — ${failedAttempts} failed attempts on ${criterionId}\n` +
    `Repeated failures often signal an architectural problem, not a simple bug.\n` +
    `\n` +
    `CONSIDER:\n` +
    `1. Pause and question your fundamental approach\n` +
    `2. Use FirstPrinciples skill to decompose the root cause\n` +
    `3. Use Council skill to get adversarial perspectives\n` +
    `4. Check if the criterion itself is correctly formulated\n` +
    `\n` +
    `Continuing with the same fix strategy is likely to waste tokens.`
  );
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: ArchEscalationDeps = {
  getPaiDir: () => getPaiDir(),
  now: () => Date.now(),
  stderr: (msg) => process.stderr.write(`${msg}\n`),
  fileExists,
  readJson,
  writeJson,
  ensureDir,
};

export const ArchitectureEscalation: SyncHookContract<
  ToolHookInput,
  ContinueOutput,
  ArchEscalationDeps
> = {
  name: "ArchitectureEscalation",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "TaskUpdate";
  },

  execute(input: ToolHookInput, deps: ArchEscalationDeps): Result<ContinueOutput, PaiError> {
    const { tool_input, session_id } = input;
    const taskId = tool_input.taskId;
    const status = tool_input.status;

    // Only track in_progress transitions
    if (typeof taskId !== "string" || taskId.trim() === "") {
      return ok(continueOk());
    }
    if (status !== "in_progress") {
      return ok(continueOk());
    }

    const criterionId = taskId.trim();
    const state = loadState(session_id, deps);

    if (!state.criteria[criterionId]) {
      state.criteria[criterionId] = { inProgressCount: 0, lastSeenAt: 0 };
    }

    const record = state.criteria[criterionId];
    record.inProgressCount += 1;
    record.lastSeenAt = deps.now();

    saveState(state, deps);

    const failedAttempts = record.inProgressCount - 1;

    deps.stderr(
      `[ArchEscalation] ${criterionId}: inProgressCount=${record.inProgressCount}, failedAttempts=${failedAttempts}`,
    );

    if (failedAttempts >= STOP_THRESHOLD) {
      const message = buildWarningMessage(criterionId, failedAttempts);
      deps.stderr(
        `[ArchEscalation] 🚨 STOP escalation for ${criterionId} (${failedAttempts} failures)`,
      );
      return ok(continueOk(message));
    }

    if (failedAttempts >= WARN_THRESHOLD) {
      const message = buildWarningMessage(criterionId, failedAttempts);
      deps.stderr(
        `[ArchEscalation] ⚠️  Warning escalation for ${criterionId} (${failedAttempts} failures)`,
      );
      return ok(continueOk(message));
    }

    return ok(continueOk());
  },

  defaultDeps,
};
