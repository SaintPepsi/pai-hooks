/**
 * AgentSpawnTracker Contract — Notify Koord daemon when a background agent spawns.
 *
 * Event: PostToolUse (Agent tool)
 *
 * Fires after the Agent tool is invoked with run_in_background: true.
 * Extracts agent_name, thread_id, and task from tool_input, then POSTs
 * to the daemon /spawn endpoint so it can track the spawned agent.
 *
 * Requires a valid thread_id (17-20 digit Discord snowflake) — skips
 * the /spawn call if missing to avoid polluting delegation tracking.
 *
 * Reads daemon URL from:
 *   1. KOORD_DAEMON_URL env var (set by daemon when spawning thread agents)
 *   2. hookConfig.koordDaemon.url in ~/.claude/settings.json (fallback)
 *
 * Fails silently on all errors — never blocks agent spawning.
 *
 * Source: /Users/hogers/Projects/koord/.claude/hooks/AgentSpawnTracker.hook.js
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { FetchResult } from "@hooks/core/adapters/fetch";
import { safeFetch } from "@hooks/core/adapters/fetch";
import type { AsyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  defaultReadFileOrNull,
  extractAgentName,
  extractTask,
  extractThreadId,
  readKoordConfig,
} from "@hooks/hooks/KoordDaemon/shared";
import { defaultStderr } from "@hooks/lib/paths";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentSpawnTrackerDeps {
  getEnv: (name: string) => string | undefined;
  safeFetch: (
    url: string,
    opts: { timeout?: number; method?: string; headers?: Record<string, string>; body?: string },
  ) => Promise<Result<FetchResult, ResultError>>;
  getKoordConfig: () => { url: string | null };
  stderr: (msg: string) => void;
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: AgentSpawnTrackerDeps = {
  getEnv: (name) => process.env[name],
  safeFetch,
  getKoordConfig: () => readKoordConfig(defaultReadFileOrNull),
  stderr: defaultStderr,
};

// ─── Contract ────────────────────────────────────────────────────────────────

export const AgentSpawnTracker: AsyncHookContract<ToolHookInput, AgentSpawnTrackerDeps> = {
  name: "AgentSpawnTracker",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "Agent";
  },

  async execute(
    input: ToolHookInput,
    deps: AgentSpawnTrackerDeps,
  ): Promise<Result<SyncHookJSONOutput, ResultError>> {
    const toolInput = input.tool_input;

    // Only fire for background agents
    if (!toolInput.run_in_background) {
      return ok({ continue: true });
    }

    // Extract thread_id — require a valid Discord snowflake
    const threadId = extractThreadId(toolInput);
    if (!threadId) {
      deps.stderr("[AgentSpawnTracker] No valid thread_id found — skipping /spawn");
      return ok({ continue: true });
    }

    // Extract agent_name (fallback "background-agent") and task
    const agentName = extractAgentName(toolInput) ?? "background-agent";
    const task = extractTask(toolInput);

    // Resolve daemon URL: env var first, then settings.json fallback
    const envUrl = deps.getEnv("KOORD_DAEMON_URL");
    const daemonUrl = envUrl ?? deps.getKoordConfig().url;
    if (!daemonUrl) {
      deps.stderr("[AgentSpawnTracker] No daemon URL found (env or settings.json)");
      return ok({ continue: true });
    }

    // POST to daemon /spawn endpoint
    const baseUrl = daemonUrl.replace(/\/+$/, "");
    const url = `${baseUrl}/spawn`;
    const body: Record<string, string> = { thread_id: threadId, agent_name: agentName };
    if (task) body.task = task;

    const result = await deps.safeFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeout: 3000,
    });

    if (result.ok) {
      deps.stderr(`[AgentSpawnTracker] Notified daemon: spawn ${agentName} → ${threadId}`);
    } else {
      deps.stderr(
        `[AgentSpawnTracker] Daemon notify failed (non-blocking): ${result.error.message}`,
      );
    }

    return ok({ continue: true });
  },

  defaultDeps,
};
