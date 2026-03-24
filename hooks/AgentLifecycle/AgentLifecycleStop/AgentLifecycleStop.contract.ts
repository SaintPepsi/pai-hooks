/**
 * AgentLifecycleStop Contract — Marks agent complete and cleans up orphans.
 *
 * Source: contracts/AgentLifecycle.ts (AgentLifecycleStop export)
 */

import type { SyncHookContract } from "@hooks/core/contract";
import type { SubagentStopInput } from "@hooks/core/types/hook-inputs";
import type { SilentOutput } from "@hooks/core/types/hook-outputs";
import { ok, tryCatch, type Result } from "@hooks/core/result";
import { type PaiError, jsonParseFailed } from "@hooks/core/error";
import {
  type AgentFileData,
  type AgentLifecycleDeps,
  defaultDeps,
  agentFilePath,
  cleanupOrphans,
} from "@hooks/hooks/AgentLifecycle/shared";

export const AgentLifecycleStop: SyncHookContract<
  SubagentStopInput,
  SilentOutput,
  AgentLifecycleDeps
> = {
  name: "AgentLifecycleStop",
  event: "SubagentStop",

  accepts(_input: SubagentStopInput): boolean {
    return true;
  },

  execute(
    input: SubagentStopInput,
    deps: AgentLifecycleDeps,
  ): Result<SilentOutput, PaiError> {
    const dirResult = deps.ensureDir(deps.getAgentsDir());
    if (!dirResult.ok) {
      deps.stderr(
        `[AgentLifecycle] Stop: failed to ensure agents dir: ${dirResult.error}`,
      );
      return ok({ type: "silent" });
    }

    const filePath = agentFilePath(deps, input.session_id);
    const nowIso = deps.now().toISOString();

    let data: AgentFileData;

    if (deps.fileExists(filePath)) {
      const contentResult = deps.readFile(filePath);
      if (contentResult.ok) {
        const parseResult = tryCatch(
          () => JSON.parse(contentResult.value) as AgentFileData,
          (e) => jsonParseFailed(contentResult.value, e),
        );
        if (parseResult.ok) {
          data = parseResult.value;
          data.completedAt = nowIso;
        } else {
          // Corrupt file — crash recovery
          deps.stderr(
            `[AgentLifecycle] Stop: corrupt file, crash recovery for ${input.session_id}`,
          );
          data = {
            agentId: input.session_id,
            agentType: "unknown",
            startedAt: nowIso,
            completedAt: nowIso,
          };
        }
      } else {
        // Read failed on existing file — crash recovery
        deps.stderr(
          `[AgentLifecycle] Stop: read failed, crash recovery for ${input.session_id}`,
        );
        data = {
          agentId: input.session_id,
          agentType: "unknown",
          startedAt: nowIso,
          completedAt: nowIso,
        };
      }
    } else {
      // File missing — crash recovery
      deps.stderr(
        `[AgentLifecycle] Stop: file missing, crash recovery for ${input.session_id}`,
      );
      data = {
        agentId: input.session_id,
        agentType: "unknown",
        startedAt: nowIso,
        completedAt: nowIso,
      };
    }

    const writeResult = deps.writeFile(filePath, JSON.stringify(data));
    if (!writeResult.ok) {
      deps.stderr(
        `[AgentLifecycle] Stop: failed to write agent file: ${writeResult.error}`,
      );
      return ok({ type: "silent" });
    }

    deps.stderr(
      `[AgentLifecycle] Stop: agent=${input.session_id}`,
    );

    // Opportunistic orphan cleanup
    cleanupOrphans(deps, input.session_id);

    return ok({ type: "silent" });
  },

  defaultDeps,
};
