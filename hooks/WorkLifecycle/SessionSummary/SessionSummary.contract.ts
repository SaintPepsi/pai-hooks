/**
 * SessionSummary Contract — Mark work complete and clear state at session end.
 *
 * Finalizes a session by marking the WORK/ directory as COMPLETED,
 * deleting current-work state, and resetting the terminal tab.
 */

import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { fileExists, readFile, readJson, removeFile, writeFile } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import { defaultStderr, getPaiDir } from "@hooks/lib/paths";
import { getISOTimestamp } from "@hooks/lib/time";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SessionSummaryDeps {
  fileExists: (path: string) => boolean;
  readFile: (path: string) => Result<string, ResultError>;
  readJson: <T = unknown>(path: string) => Result<T, ResultError>;
  writeFile: (path: string, content: string) => Result<void, ResultError>;
  unlinkSync: (path: string) => void;
  getTimestamp: () => string;
  baseDir: string;
  stderr: (msg: string) => void;
}

// ─── Pure Logic ──────────────────────────────────────────────────────────────

function findStateFile(
  sessionId: string | undefined,
  stateDir: string,
  deps: SessionSummaryDeps,
): string | null {
  if (!sessionId) return null;
  const scoped = join(stateDir, `current-work-${sessionId}.json`);
  if (deps.fileExists(scoped)) return scoped;
  return null;
}

function clearSessionWork(sessionId: string | undefined, deps: SessionSummaryDeps): void {
  const stateDir = join(deps.baseDir, "MEMORY", "STATE");
  const workDir = join(deps.baseDir, "MEMORY", "WORK");

  const stateFile = findStateFile(sessionId, stateDir, deps);
  if (!stateFile) {
    deps.stderr("[SessionSummary] No current work to complete");
    return;
  }

  const result = deps.readJson<{ session_id: string; session_dir: string }>(stateFile);
  if (!result.ok) return;
  const currentWork = result.value;

  if (sessionId && currentWork.session_id !== sessionId) {
    deps.stderr("[SessionSummary] State file belongs to different session, skipping");
    return;
  }

  if (currentWork.session_dir) {
    const metaPath = join(workDir, currentWork.session_dir, "META.yaml");
    const metaResult = deps.readFile(metaPath);
    if (metaResult.ok) {
      let metaContent = metaResult.value;
      metaContent = metaContent.replace(/^status: "ACTIVE"$/m, 'status: "COMPLETED"');
      metaContent = metaContent.replace(
        /^completed_at: null$/m,
        `completed_at: "${deps.getTimestamp()}"`,
      );
      deps.writeFile(metaPath, metaContent);
      deps.stderr(
        `[SessionSummary] Marked work directory as COMPLETED: ${currentWork.session_dir}`,
      );
    }
  }

  deps.unlinkSync(stateFile);
  deps.stderr("[SessionSummary] Cleared session work state");
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: SessionSummaryDeps = {
  fileExists,
  readFile,
  readJson,
  writeFile,
  unlinkSync: (path) => {
    removeFile(path);
  },
  getTimestamp: getISOTimestamp,
  baseDir: getPaiDir(),
  stderr: defaultStderr,
};

export const SessionSummary: SyncHookContract<SessionEndInput, SessionSummaryDeps> = {
  name: "SessionSummary",
  event: "SessionEnd",

  accepts(_input: SessionEndInput): boolean {
    return true;
  },

  execute(
    input: SessionEndInput,
    deps: SessionSummaryDeps,
  ): Result<SyncHookJSONOutput, ResultError> {
    clearSessionWork(input.session_id, deps);

    return ok({});
  },

  defaultDeps,
};
