/**
 * AgentTracker Contract — Track active sub-agent count per Claude session.
 *
 * Two contracts exported:
 *   AgentTrackerPre  — PreToolUse: increments agent count when Agent tool fires
 *   AgentTrackerPost — PostToolUse: decrements agent count when Agent tool completes
 *
 * State file: MEMORY/STATE/active-agents-{pid}.json
 *   { count: number, maxCount: number, updatedAt: string }
 *
 * The statusline reads these files, filters by live PIDs, and sums agent counts.
 */

import type { SyncHookContract } from "@hooks/core/contract";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import {
  readFile,
  writeFile,
  fileExists,
  ensureDir,
} from "@hooks/core/adapters/fs";
import { getPaiDir } from "@hooks/lib/paths";
import { join } from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentState {
  count: number;
  maxCount: number;
  updatedAt: string;
}

export interface AgentTrackerDeps {
  readFile: (path: string) => Result<string, PaiError>;
  writeFile: (path: string, content: string) => Result<void, PaiError>;
  fileExists: (path: string) => boolean;
  ensureDir: (path: string) => Result<void, PaiError>;
  getStatePath: () => string;
  stderr: (msg: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stateFilePath(deps: AgentTrackerDeps): string {
  const pid = process.ppid || process.pid;
  return join(deps.getStatePath(), `active-agents-${pid}.json`);
}

function readState(deps: AgentTrackerDeps): AgentState {
  const path = stateFilePath(deps);
  if (!deps.fileExists(path)) {
    return { count: 0, maxCount: 0, updatedAt: new Date().toISOString() };
  }
  const content = deps.readFile(path);
  if (!content.ok) {
    return { count: 0, maxCount: 0, updatedAt: new Date().toISOString() };
  }
  const parsed = JSON.parse(content.value) as AgentState;
  return {
    count: typeof parsed.count === "number" ? parsed.count : 0,
    maxCount: typeof parsed.maxCount === "number" ? parsed.maxCount : 0,
    updatedAt: parsed.updatedAt || new Date().toISOString(),
  };
}

function writeState(deps: AgentTrackerDeps, state: AgentState): void {
  deps.ensureDir(deps.getStatePath());
  deps.writeFile(stateFilePath(deps), JSON.stringify(state));
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: AgentTrackerDeps = {
  readFile,
  writeFile,
  fileExists,
  ensureDir,
  getStatePath: () => join(getPaiDir(), "MEMORY", "STATE"),
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

// ─── PreToolUse Contract (increment) ─────────────────────────────────────────

export const AgentTrackerPre: SyncHookContract<
  ToolHookInput,
  ContinueOutput,
  AgentTrackerDeps
> = {
  name: "AgentTrackerPre",
  event: "PreToolUse",

  accepts(_input: ToolHookInput): boolean {
    return true;
  },

  execute(
    _input: ToolHookInput,
    deps: AgentTrackerDeps,
  ): Result<ContinueOutput, PaiError> {
    const state = readState(deps);
    state.count += 1;
    if (state.count > state.maxCount) {
      state.maxCount = state.count;
    }
    state.updatedAt = new Date().toISOString();
    writeState(deps, state);

    deps.stderr(
      `[AgentTracker] Pre: agents=${state.count} max=${state.maxCount}`,
    );

    return ok({ type: "continue", continue: true });
  },

  defaultDeps,
};

// ─── PostToolUse Contract (decrement) ────────────────────────────────────────

export const AgentTrackerPost: SyncHookContract<
  ToolHookInput,
  ContinueOutput,
  AgentTrackerDeps
> = {
  name: "AgentTrackerPost",
  event: "PostToolUse",

  accepts(_input: ToolHookInput): boolean {
    return true;
  },

  execute(
    _input: ToolHookInput,
    deps: AgentTrackerDeps,
  ): Result<ContinueOutput, PaiError> {
    const state = readState(deps);
    state.count = Math.max(0, state.count - 1);
    state.updatedAt = new Date().toISOString();
    writeState(deps, state);

    deps.stderr(
      `[AgentTracker] Post: agents=${state.count} max=${state.maxCount}`,
    );

    return ok({ type: "continue", continue: true });
  },

  defaultDeps,
};
