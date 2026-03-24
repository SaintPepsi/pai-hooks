/**
 * SessionSummary Contract — Mark work complete and clear state at session end.
 *
 * Finalizes a session by marking the WORK/ directory as COMPLETED,
 * deleting current-work state, and resetting the Kitty tab.
 */

import type { SyncHookContract } from "@hooks/core/contract";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import type { SilentOutput } from "@hooks/core/types/hook-outputs";
import { ok, tryCatch, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { unknownError } from "@hooks/core/error";
import { fileExists, readFile, readJson, writeFile, removeFile } from "@hooks/core/adapters/fs";
import { join } from "path";
import { getISOTimestamp } from "@hooks/lib/time";
import { setTabState, cleanupKittySession } from "@hooks/lib/tab-setter";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SessionSummaryDeps {
  fileExists: (path: string) => boolean;
  readFile: (path: string) => Result<string, PaiError>;
  readJson: <T = unknown>(path: string) => Result<T, PaiError>;
  writeFile: (path: string, content: string) => Result<void, PaiError>;
  unlinkSync: (path: string) => void;
  getTimestamp: () => string;
  setTabState: (opts: { title: string; state: string; sessionId: string }) => void;
  cleanupKittySession: (sessionId: string) => void;
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

function clearSessionWork(
  sessionId: string | undefined,
  deps: SessionSummaryDeps,
): void {
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
      deps.stderr(`[SessionSummary] Marked work directory as COMPLETED: ${currentWork.session_dir}`);
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
  unlinkSync: (path) => { removeFile(path); },
  getTimestamp: getISOTimestamp,
  setTabState: (opts) => setTabState(opts as Parameters<typeof setTabState>[0]),
  cleanupKittySession: (id) => cleanupKittySession(id),
  baseDir: process.env.PAI_DIR || join(process.env.HOME!, ".claude"),
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const SessionSummary: SyncHookContract<
  SessionEndInput,
  SilentOutput,
  SessionSummaryDeps
> = {
  name: "SessionSummary",
  event: "SessionEnd",

  accepts(_input: SessionEndInput): boolean {
    return true;
  },

  execute(
    input: SessionEndInput,
    deps: SessionSummaryDeps,
  ): Result<SilentOutput, PaiError> {
    clearSessionWork(input.session_id, deps);

    const tabResult = tryCatch(
      () => deps.setTabState({ title: "", state: "idle", sessionId: input.session_id }),
      (e) => unknownError(e),
    );
    if (tabResult.ok) {
      deps.stderr("[SessionSummary] Tab reset to default styling");
    } else {
      deps.stderr("[SessionSummary] Tab reset failed (non-critical)");
    }

    if (input.session_id) {
      tryCatch(
        () => deps.cleanupKittySession(input.session_id),
        (e) => unknownError(e),
      );
    }

    return ok({ type: "silent" });
  },

  defaultDeps,
};
