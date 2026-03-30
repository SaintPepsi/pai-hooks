/**
 * SessionIdRegister Contract — Register session ID with Koord daemon on start.
 *
 * Event: SessionStart
 *
 * When a thread agent starts, registers its session_id with the daemon so
 * messages include the session ID from the first message.
 *
 * Reads daemon URL from:
 *   1. KOORD_DAEMON_URL env var (set by daemon when spawning thread agents)
 *   2. hookConfig.koordDaemon.url in ~/.claude/settings.json (fallback)
 *
 * Reads thread ID from KOORD_THREAD_ID env var.
 * If either is missing, exits silently (session was not daemon-spawned).
 *
 * Source: /Users/hogers/Projects/koord/.claude/hooks/SessionIdRegister.hook.js
 */

import type { FetchResult } from "@hooks/core/adapters/fetch";
import { safeFetch } from "@hooks/core/adapters/fetch";
import type { AsyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import type { SilentOutput } from "@hooks/core/types/hook-outputs";
import { defaultStderr } from "@hooks/lib/paths";
import { defaultReadFileOrNull, readKoordConfig } from "@hooks/hooks/KoordDaemon/shared";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SessionIdRegisterDeps {
  getEnv: (name: string) => string | undefined;
  safeFetch: (
    url: string,
    opts: { timeout?: number; method?: string; headers?: Record<string, string>; body?: string },
  ) => Promise<Result<FetchResult, PaiError>>;
  getKoordConfig: () => { url: string | null };
  stderr: (msg: string) => void;
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: SessionIdRegisterDeps = {
  getEnv: (name) => process.env[name],
  safeFetch,
  getKoordConfig: () => readKoordConfig(defaultReadFileOrNull),
  stderr: defaultStderr,
};

// ─── Contract ────────────────────────────────────────────────────────────────

export const SessionIdRegister: AsyncHookContract<
  SessionStartInput,
  SilentOutput,
  SessionIdRegisterDeps
> = {
  name: "SessionIdRegister",
  event: "SessionStart",

  accepts(_input: SessionStartInput): boolean {
    return true;
  },

  async execute(
    input: SessionStartInput,
    deps: SessionIdRegisterDeps,
  ): Promise<Result<SilentOutput, PaiError>> {
    const sessionId = input.session_id;
    if (!sessionId) {
      deps.stderr("[SessionIdRegister] No session_id in hook input");
      return ok({ type: "silent" });
    }

    // Read thread ID from env var
    const threadId = deps.getEnv("KOORD_THREAD_ID");
    if (!threadId) {
      deps.stderr("[SessionIdRegister] No KOORD_THREAD_ID env var — not a Koord thread agent");
      return ok({ type: "silent" });
    }

    // Resolve daemon URL: env var first, then settings.json fallback
    const envUrl = deps.getEnv("KOORD_DAEMON_URL");
    const daemonUrl = envUrl ?? deps.getKoordConfig().url;
    if (!daemonUrl) {
      deps.stderr("[SessionIdRegister] No daemon URL found (env or settings.json)");
      return ok({ type: "silent" });
    }

    const baseUrl = daemonUrl.replace(/\/+$/, "");
    const url = `${baseUrl}/register-session`;
    const body = JSON.stringify({ sessionId, threadId });

    const result = await deps.safeFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      timeout: 3000,
    });

    if (result.ok) {
      deps.stderr(
        `[SessionIdRegister] Registered session: thread=${threadId} session=${sessionId.slice(0, 8)}...`,
      );
    } else {
      deps.stderr(
        `[SessionIdRegister] Registration failed (non-blocking): ${result.error.message}`,
      );
    }

    return ok({ type: "silent" });
  },

  defaultDeps,
};
