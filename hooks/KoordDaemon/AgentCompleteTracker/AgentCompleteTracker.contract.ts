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

import type { FetchResult } from "@hooks/core/adapters/fetch";
import { safeFetch } from "@hooks/core/adapters/fetch";
import type { AsyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import { defaultStderr } from "@hooks/lib/paths";
import { continueOk } from "@hooks/core/types/hook-outputs";
import {
  defaultReadFileOrNull,
  extractThreadIdFromOutput,
  readKoordConfig,
} from "@hooks/hooks/KoordDaemon/shared";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AgentCompleteTrackerDeps {
  getEnv: (name: string) => string | undefined;
  safeFetch: (
    url: string,
    opts: { timeout?: number; method?: string; headers?: Record<string, string>; body?: string },
  ) => Promise<Result<FetchResult, PaiError>>;
  getKoordConfig: () => { url: string | null };
  stderr: (msg: string) => void;
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: AgentCompleteTrackerDeps = {
  getEnv: (name) => process.env[name],
  safeFetch,
  getKoordConfig: () => readKoordConfig(defaultReadFileOrNull),
  stderr: defaultStderr,
};

// ─── Contract ────────────────────────────────────────────────────────────────

export const AgentCompleteTracker: AsyncHookContract<
  ToolHookInput,
  ContinueOutput,
  AgentCompleteTrackerDeps
> = {
  name: "AgentCompleteTracker",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "Agent";
  },

  async execute(
    input: ToolHookInput,
    deps: AgentCompleteTrackerDeps,
  ): Promise<Result<ContinueOutput, PaiError>> {
    // Skip spawn events — those are handled by AgentSpawnTracker
    if (input.tool_input.run_in_background === true) {
      return ok(continueOk());
    }

    // Extract thread_id from output and top-level only (NOT tool_input).
    // Build a record that maps both tool_response (typed ToolHookInput field)
    // and tool_output (raw Claude Code JSON field) so extraction works in
    // both production (raw JSON has tool_output) and tests (typed fixture has tool_response).
    const raw = input as unknown as Record<string, unknown>;
    const record: Record<string, unknown> = { ...raw };
    if (!("tool_output" in record) && typeof input.tool_response === "string") {
      record.tool_output = input.tool_response;
    }
    const threadId = extractThreadIdFromOutput(record);
    if (!threadId) {
      return ok(continueOk());
    }

    // Resolve daemon URL: env var first, then settings.json fallback
    const envUrl = deps.getEnv("KOORD_DAEMON_URL");
    const daemonUrl = envUrl ?? deps.getKoordConfig().url;
    if (!daemonUrl) {
      deps.stderr("[AgentCompleteTracker] No daemon URL found (env or settings.json)");
      return ok(continueOk());
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

    return ok(continueOk());
  },

  defaultDeps,
};
