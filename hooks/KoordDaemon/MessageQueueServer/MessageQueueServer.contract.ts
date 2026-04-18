/**
 * MessageQueueServer Contract — Spawn message queue server on session start.
 *
 * Event: SessionStart
 *
 * On session start, spawns a detached Bun HTTP server (scripts/mq-server.ts)
 * that accepts messages from the Koord daemon. Returns context instructing
 * the agent to start the message queue watcher for realtime relay.
 *
 * The server listens on an auto-assigned port and writes it to:
 *   /tmp/pai-mq/{session_id}/port
 *
 * Reads daemon URL from:
 *   1. KOORD_DAEMON_URL env var
 *   2. hookConfig.koordDaemon.url in ~/.claude/settings.json
 *
 * If no daemon URL is configured, skips silently (not a Koord session).
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { getEnv as getEnvAdapter } from "@hooks/core/adapters/process";
import type { AsyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result, tryCatch } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import {
  defaultReadFileOrNull,
  getQueueDir,
  readKoordConfig,
} from "@hooks/hooks/KoordDaemon/shared";
import { defaultStderr } from "@hooks/lib/paths";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MessageQueueServerDeps {
  getEnv: (name: string) => string | undefined;
  getKoordConfig: () => { url: string | null };
  spawnDetached: (cmd: string, args: string[]) => { ok: boolean };
  fileExists: (path: string) => boolean;
  stderr: (msg: string) => void;
  getScriptPath: () => string;
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: MessageQueueServerDeps = {
  getEnv: (name) => {
    const result = getEnvAdapter(name);
    return result.ok ? result.value : undefined;
  },
  getKoordConfig: () => readKoordConfig(defaultReadFileOrNull),
  spawnDetached: (cmd, args) => {
    const result = tryCatch(
      () => {
        const child = Bun.spawn([cmd, ...args], {
          stdout: "ignore",
          stderr: "pipe",
          stdin: "ignore",
        });
        child.unref();
        return true;
      },
      () => null,
    );
    return { ok: result.ok };
  },
  fileExists: (path) => {
    const result = tryCatch(
      () => Bun.file(path).size > 0,
      () => null,
    );
    return result.ok ? result.value : false;
  },
  stderr: defaultStderr,
  getScriptPath: () => {
    // Resolve relative to this file's location → ../../scripts/mq-server.ts
    const hookDir = import.meta.dir;
    return `${hookDir}/../../../scripts/mq-server.ts`;
  },
};

// ─── Contract ────────────────────────────────────────────────────────────────

export const MessageQueueServer: AsyncHookContract<SessionStartInput, MessageQueueServerDeps> = {
  name: "MessageQueueServer",
  event: "SessionStart",

  accepts(_input: SessionStartInput): boolean {
    return true;
  },

  async execute(
    input: SessionStartInput,
    deps: MessageQueueServerDeps,
  ): Promise<Result<SyncHookJSONOutput, ResultError>> {
    const sessionId = input.session_id;
    if (!sessionId) {
      deps.stderr("[MessageQueueServer] No session_id in hook input");
      return ok({});
    }

    // Only activate if Koord daemon is configured
    const envUrl = deps.getEnv("KOORD_DAEMON_URL");
    const daemonUrl = envUrl ?? deps.getKoordConfig().url;
    if (!daemonUrl) {
      deps.stderr("[MessageQueueServer] No daemon URL configured — skipping MQ server");
      return ok({});
    }

    // Check if server is already running for this session
    const queueDir = getQueueDir(sessionId);
    const portFile = `${queueDir}/port`;
    if (deps.fileExists(portFile)) {
      deps.stderr("[MessageQueueServer] Server already running — skipping spawn");
      return ok({});
    }

    // Spawn the detached mq-server process
    const scriptPath = deps.getScriptPath();
    const result = deps.spawnDetached("bun", ["run", scriptPath, "--session", sessionId]);

    if (!result.ok) {
      deps.stderr("[MessageQueueServer] Failed to spawn mq-server (non-blocking)");
      return ok({});
    }

    deps.stderr(`[MessageQueueServer] Spawned mq-server for session ${sessionId.slice(0, 8)}...`);

    // Wait briefly for server to write port file
    await Bun.sleep(300);

    return ok({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: [
          "## Message Queue Active",
          "",
          "A message queue server has been started for this session.",
          `The Koord daemon can push messages to it for realtime relay.`,
          "",
          "**To start listening for messages, run:**",
          "```",
          `bun scripts/mq-watcher.ts --session ${sessionId}`,
          "```",
          "",
          "When a message arrives, the watcher will exit with the message content.",
          "The MessageQueueRelay hook will prompt you to process it and respawn the watcher.",
          "This creates a persistent message loop for realtime communication.",
        ].join("\n"),
      },
    });
  },

  defaultDeps,
};
