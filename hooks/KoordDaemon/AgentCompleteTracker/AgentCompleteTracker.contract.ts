/**
 * AgentCompleteTracker Contract — Notify Koord daemon when a background agent completes.
 *
 * Event: PostToolUse (Agent tool)
 *
 * Fires when PostToolUse triggers for the Agent tool. Skips spawn events
 * (run_in_background: true in tool_input) — those are handled by AgentSpawnTracker.
 * Completion events do NOT have run_in_background set.
 *
 * Extracts thread_id from tool_output and top-level input ONLY (not from tool_input —
 * that would cause false positives at spawn time). If no thread_id found, exits silently.
 *
 * POSTs to daemon /complete endpoint with { thread_id }.
 *
 * Reads daemon URL from:
 *   1. KOORD_DAEMON_URL env var (set by daemon when spawning thread agents)
 *   2. hookConfig.koordDaemon.url in ~/.claude/settings.json (fallback)
 *
 * Fails silently on all errors (never blocks agent completion).
 *
 * Source: /Users/hogers/Projects/koord/.claude/hooks/AgentCompleteTracker.hook.js
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { FetchResult } from "@hooks/core/adapters/fetch";
import { safeFetch } from "@hooks/core/adapters/fetch";
import { getEnv as getEnvAdapter } from "@hooks/core/adapters/process";
import type { AsyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ThreadIdOutputInput } from "@hooks/hooks/KoordDaemon/shared";
import {
  defaultReadFileOrNull,
  extractThreadIdFromOutput,
  readKoordConfig,
} from "@hooks/hooks/KoordDaemon/shared";
import { defaultStderr } from "@hooks/lib/paths";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentCompleteTrackerDeps {
  getEnv: (name: string) => string | undefined;
  safeFetch: (
    url: string,
    opts: { timeout?: number; method?: string; headers?: Record<string, string>; body?: string },
  ) => Promise<Result<FetchResult, ResultError>>;
  getKoordConfig: () => { url: string | null };
  stderr: (msg: string) => void;
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: AgentCompleteTrackerDeps = {
  getEnv: (name) => {
    const result = getEnvAdapter(name);
    return result.ok ? result.value : undefined;
  },
  safeFetch,
  getKoordConfig: () => readKoordConfig(defaultReadFileOrNull),
  stderr: defaultStderr,
};

// ─── Contract ────────────────────────────────────────────────────────────────

export const AgentCompleteTracker: AsyncHookContract<ToolHookInput, AgentCompleteTrackerDeps> = {
  name: "AgentCompleteTracker",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "Agent";
  },

  async execute(
    input: ToolHookInput,
    deps: AgentCompleteTrackerDeps,
  ): Promise<Result<SyncHookJSONOutput, ResultError>> {
    // Skip spawn events — those are handled by AgentSpawnTracker
    if (input.tool_input.run_in_background === true) {
      return ok({ continue: true });
    }

    // Extract thread_id from output and top-level only (NOT tool_input).
    // ToolHookInput now includes both tool_response and tool_output (#161),
    // so extraction works in both production and tests without unsafe casts.
    const record: Record<string, unknown> = {
      session_id: input.session_id,
      tool_name: input.tool_name,
      tool_input: input.tool_input,
      tool_response: input.tool_response,
      tool_output: input.tool_output ?? input.tool_response,
    };
    const threadId = extractThreadIdFromOutput(record);
    if (!threadId) {
      return ok({ continue: true });
    }

    // Resolve daemon URL: env var first, then settings.json fallback
    const envUrl = deps.getEnv("KOORD_DAEMON_URL");
    const daemonUrl = envUrl ?? deps.getKoordConfig().url;
    if (!daemonUrl) {
      deps.stderr("[AgentCompleteTracker] No daemon URL found (env or settings.json)");
      return ok({ continue: true });
    }

    const baseUrl = daemonUrl.replace(/\/+$/, "");
    const url = `${baseUrl}/complete`;
    const body = JSON.stringify({ thread_id: threadId });

    const result = await deps.safeFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      timeout: 3000,
    });

    if (result.ok) {
      deps.stderr(`[AgentCompleteTracker] Notified daemon: complete ${threadId}`);
    } else {
      deps.stderr(
        `[AgentCompleteTracker] Daemon notify failed (non-blocking): ${result.error.message}`,
      );
    }

    return ok({ continue: true });
  },

  defaultDeps,
};
