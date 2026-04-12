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

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result, tryCatch } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { MQ_WATCHER_MARKER } from "@hooks/hooks/KoordDaemon/shared";
import { defaultStderr } from "@hooks/lib/paths";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MessageQueueRelayDeps {
  stderr: (msg: string) => void;
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const defaultDeps: MessageQueueRelayDeps = {
  stderr: defaultStderr,
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
  const result = tryCatch(
    () => JSON.parse(raw) as Record<string, unknown>,
    () => null,
  );
  if (!result.ok) return { body: raw.trim() };
  const parsed = result.value;
  return {
    ...parsed,
    body: typeof parsed.body === "string" ? parsed.body : raw,
  };
}

// ─── Contract ────────────────────────────────────────────────────────────────

export const MessageQueueRelay: SyncHookContract<ToolHookInput, MessageQueueRelayDeps> = {
  name: "MessageQueueRelay",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "Bash";
  },

  execute(
    input: ToolHookInput,
    deps: MessageQueueRelayDeps,
  ): Result<SyncHookJSONOutput, ResultError> {
    const command = input.tool_input.command;

    // Only intercept mq-watcher completions
    if (!isWatcherCommand(command)) {
      return ok({ continue: true });
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
      return ok({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: [
            "## Message Queue: Watcher Timeout",
            "",
            "The message queue watcher timed out with no new messages.",
            "**Respawn the watcher to continue listening:**",
            "```",
            respawnCmd,
            "```",
          ].join("\n"),
        },
      });
    }

    // Parse the message
    const message = parseWatcherOutput(responseText);
    const sessionId = extractSessionFromCommand(command as string);
    const from = message.from ? ` from ${message.from}` : "";

    deps.stderr(`[MessageQueueRelay] Relaying message${from}`);

    const respawnCmd = sessionId
      ? `bun scripts/mq-watcher.ts --session ${sessionId}`
      : "bun scripts/mq-watcher.ts --session <session_id>";

    return ok({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: [
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
      },
    });
  },

  defaultDeps,
};
