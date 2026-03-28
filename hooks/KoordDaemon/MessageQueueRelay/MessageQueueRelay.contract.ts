/**
 * MessageQueueRelay Contract — Detect watcher exit and relay messages.
 *
 * Event: PostToolUse (Bash)
 *
 * When the Bash tool completes and the command was the mq-watcher script,
 * this hook injects the message as additional context and instructs the
 * agent to process it and immediately respawn the watcher.
 *
 * This creates a persistent loop:
 *   Agent runs watcher → watcher blocks → message arrives → watcher exits →
 *   PostToolUse fires → relay injects message + respawn directive →
 *   agent processes message and runs watcher again → repeat forever
 *
 * Detection: Checks if tool_input.command contains "mq-watcher".
 * Message: Read from tool_response (watcher's stdout output).
 */

import type { SyncHookContract } from "@hooks/core/contract";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import { continueOk } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { MQ_WATCHER_MARKER } from "@hooks/hooks/KoordDaemon/shared";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MessageQueueRelayDeps {
  stderr: (msg: string) => void;
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: MessageQueueRelayDeps = {
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Check if a Bash command is the mq-watcher script. */
function isWatcherCommand(command: unknown): boolean {
  return typeof command === "string" && command.includes(MQ_WATCHER_MARKER);
}

/** Extract session ID from the watcher command args. */
function extractSessionFromCommand(command: string): string | null {
  const match = command.match(/--session\s+(\S+)/);
  return match ? match[1] : null;
}

/** Parse message JSON from watcher stdout, with fallback to raw text. */
function parseWatcherOutput(raw: string): { from?: string; body: string; [key: string]: unknown } {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      ...parsed,
      body: typeof parsed.body === "string" ? parsed.body : raw,
    };
  } catch {
    return { body: raw.trim() };
  }
}

// ─── Contract ────────────────────────────────────────────────────────────────

export const MessageQueueRelay: SyncHookContract<
  ToolHookInput,
  ContinueOutput,
  MessageQueueRelayDeps
> = {
  name: "MessageQueueRelay",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "Bash";
  },

  execute(
    input: ToolHookInput,
    deps: MessageQueueRelayDeps,
  ): Result<ContinueOutput, PaiError> {
    const command = input.tool_input.command;

    // Only intercept mq-watcher completions
    if (!isWatcherCommand(command)) {
      return ok(continueOk());
    }

    const response = input.tool_response;
    const responseText = typeof response === "string" ? response : "";

    // Watcher timed out or had no message — just note it
    if (!responseText.trim()) {
      deps.stderr("[MessageQueueRelay] Watcher exited with no message (timeout or empty)");
      const sessionId = extractSessionFromCommand(command as string);
      const respawnCmd = sessionId
        ? `bun scripts/mq-watcher.ts --session ${sessionId}`
        : "bun scripts/mq-watcher.ts --session <session_id>";
      return ok(continueOk(
        [
          "## Message Queue: Watcher Timeout",
          "",
          "The message queue watcher timed out with no new messages.",
          "**Respawn the watcher to continue listening:**",
          "```",
          respawnCmd,
          "```",
        ].join("\n"),
      ));
    }

    // Parse the message
    const message = parseWatcherOutput(responseText);
    const sessionId = extractSessionFromCommand(command as string);
    const from = message.from ? ` from ${message.from}` : "";

    deps.stderr(`[MessageQueueRelay] Relaying message${from}`);

    const respawnCmd = sessionId
      ? `bun scripts/mq-watcher.ts --session ${sessionId}`
      : "bun scripts/mq-watcher.ts --session <session_id>";

    return ok(continueOk(
      [
        "## Message Queue: New Message Received",
        "",
        `**Message${from}:**`,
        message.body,
        "",
        "---",
        "",
        "**IMPORTANT: After processing this message, immediately respawn the watcher to continue listening:**",
        "```",
        respawnCmd,
        "```",
      ].join("\n"),
    ));
  },

  defaultDeps,
};
