/**
 * AgentLifecycle shared types, deps, and helpers.
 *
 * Used by AgentLifecycleStart and AgentLifecycleStop contracts.
 */

import type { Result } from "@hooks/core/result";
import { tryCatch } from "@hooks/core/result";
import { type PaiError, jsonParseFailed } from "@hooks/core/error";
import {
  readFile,
  writeFile,
  fileExists,
  ensureDir,
  readDir,
  removeFile,
} from "@hooks/core/adapters/fs";
import { getPaiDir } from "@hooks/lib/paths";
import { join } from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentFileData {
  agentId: string;
  agentType: string;
  startedAt: string;
  completedAt: string | null;
}

export interface AgentLifecycleDeps {
  readFile: (path: string) => Result<string, PaiError>;
  writeFile: (path: string, content: string) => Result<void, PaiError>;
  fileExists: (path: string) => boolean;
  ensureDir: (path: string) => Result<void, PaiError>;
  readDir: (path: string) => Result<string[], PaiError>;
  removeFile: (path: string) => Result<void, PaiError>;
  getAgentsDir: () => string;
  stderr: (msg: string) => void;
  now: () => Date;
}

// ─── Default Deps ────────────────────────────────────────────────────────────

export const defaultDeps: AgentLifecycleDeps = {
  readFile,
  writeFile,
  fileExists,
  ensureDir,
  readDir: (path) => readDir(path) as Result<string[], PaiError>,
  removeFile,
  getAgentsDir: () => join(getPaiDir(), "MEMORY", "STATE", "agents"),
  stderr: (msg) => process.stderr.write(msg + "\n"),
  now: () => new Date(),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export const ORPHAN_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export function agentFilePath(deps: AgentLifecycleDeps, sessionId: string): string {
  return join(deps.getAgentsDir(), `agent-${sessionId}.json`);
}

export function cleanupOrphans(
  deps: AgentLifecycleDeps,
  currentSessionId: string,
): void {
  const dirResult = deps.readDir(deps.getAgentsDir());
  if (!dirResult.ok) return;

  const nowMs = deps.now().getTime();

  for (const filename of dirResult.value) {
    if (!filename.startsWith("agent-") || !filename.endsWith(".json")) continue;

    // Extract session id from filename: agent-{id}.json
    const agentSessionId = filename.slice("agent-".length, -".json".length);

    // Never remove the current agent's file
    if (agentSessionId === currentSessionId) continue;

    const filePath = join(deps.getAgentsDir(), filename);
    const contentResult = deps.readFile(filePath);
    if (!contentResult.ok) continue;

    const parseResult = tryCatch(
      () => JSON.parse(contentResult.value) as AgentFileData,
      (e) => jsonParseFailed(contentResult.value, e),
    );
    if (!parseResult.ok) continue;
    const data = parseResult.value;

    // Only remove orphans: no completedAt and started > 30 min ago
    if (data.completedAt !== null) continue;

    const startedMs = new Date(data.startedAt).getTime();
    if (nowMs - startedMs > ORPHAN_THRESHOLD_MS) {
      deps.removeFile(filePath);
      deps.stderr(
        `[AgentLifecycle] Cleaned up orphan agent: ${data.agentId}`,
      );
    }
  }
}
