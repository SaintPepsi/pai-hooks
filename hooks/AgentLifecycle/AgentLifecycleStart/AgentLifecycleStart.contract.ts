/**
 * AgentLifecycleStart Contract — Creates per-agent lifecycle file on subagent spawn.
 *
 * Source: contracts/AgentLifecycle.ts (AgentLifecycleStart export)
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { SubagentStartInput } from "@hooks/core/types/hook-inputs";
import {
  type AgentFileData,
  type AgentLifecycleDeps,
  agentFilePath,
  defaultDeps,
} from "@hooks/hooks/AgentLifecycle/shared";

export const AgentLifecycleStart: SyncHookContract<SubagentStartInput, AgentLifecycleDeps> = {
  name: "AgentLifecycleStart",
  event: "SubagentStart",

  accepts(_input: SubagentStartInput): boolean {
    return true;
  },

  execute(
    input: SubagentStartInput,
    deps: AgentLifecycleDeps,
  ): Result<SyncHookJSONOutput, ResultError> {
    const dirResult = deps.ensureDir(deps.getAgentsDir());
    if (!dirResult.ok) {
      deps.stderr(`[AgentLifecycle] Start: failed to ensure agents dir: ${dirResult.error}`);
      return ok({});
    }

    const data: AgentFileData = {
      agentId: input.session_id,
      agentType: "unknown",
      startedAt: deps.now().toISOString(),
      completedAt: null,
    };

    const writeResult = deps.writeFile(agentFilePath(deps, input.session_id), JSON.stringify(data));

    if (!writeResult.ok) {
      deps.stderr(`[AgentLifecycle] Start: failed to write agent file: ${writeResult.error}`);
      return ok({});
    }

    deps.stderr(`[AgentLifecycle] Start: agent=${input.session_id}`);

    return ok({});
  },

  defaultDeps,
};
