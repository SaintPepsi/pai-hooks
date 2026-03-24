/**
 * AgentLifecycleStart Contract — Creates per-agent lifecycle file on subagent spawn.
 *
 * Source: contracts/AgentLifecycle.ts (AgentLifecycleStart export)
 */

import type { SyncHookContract } from "@hooks/core/contract";
import type { SubagentStartInput } from "@hooks/core/types/hook-inputs";
import type { SilentOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import {
  type AgentFileData,
  type AgentLifecycleDeps,
  defaultDeps,
  agentFilePath,
} from "@hooks/hooks/AgentLifecycle/shared";

export const AgentLifecycleStart: SyncHookContract<
  SubagentStartInput,
  SilentOutput,
  AgentLifecycleDeps
> = {
  name: "AgentLifecycleStart",
  event: "SubagentStart",

  accepts(_input: SubagentStartInput): boolean {
    return true;
  },

  execute(
    input: SubagentStartInput,
    deps: AgentLifecycleDeps,
  ): Result<SilentOutput, PaiError> {
    const dirResult = deps.ensureDir(deps.getAgentsDir());
    if (!dirResult.ok) {
      deps.stderr(
        `[AgentLifecycle] Start: failed to ensure agents dir: ${dirResult.error}`,
      );
      return ok({ type: "silent" });
    }

    const data: AgentFileData = {
      agentId: input.session_id,
      agentType: "unknown",
      startedAt: deps.now().toISOString(),
      completedAt: null,
    };

    const writeResult = deps.writeFile(
      agentFilePath(deps, input.session_id),
      JSON.stringify(data),
    );

    if (!writeResult.ok) {
      deps.stderr(
        `[AgentLifecycle] Start: failed to write agent file: ${writeResult.error}`,
      );
      return ok({ type: "silent" });
    }

    deps.stderr(
      `[AgentLifecycle] Start: agent=${input.session_id}`,
    );

    return ok({ type: "silent" });
  },

  defaultDeps,
};
