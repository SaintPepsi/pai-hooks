/**
 * KoordDaemon shared types, deps, and helpers.
 *
 * Used by SessionIdRegister, AgentPrepromptInjector, AgentSpawnTracker,
 * and AgentCompleteTracker contracts.
 *
 * Configuration via ~/.claude/settings.json:
 *   hookConfig.koordDaemon.url — daemon base URL (e.g. "http://localhost:9999")
 *   hookConfig.koordDaemon.prepromptPath — absolute path to worker preprompt template
 *
 * Source pattern: hooks/GitSafety/ProtectedBranchGuard/ProtectedBranchGuard.contract.ts
 */

import { readFile } from "@hooks/core/adapters/fs";
import { readHookConfig } from "@hooks/lib/hook-config";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KoordDaemonConfig {
  /** Daemon base URL, e.g. "http://localhost:9999" */
  url: string | null;
  /** Absolute path to worker preprompt template (.md file) */
  prepromptPath: string | null;
}

/** Discord snowflake ID pattern (17-20 digits). */
const DISCORD_ID_PATTERN = /^\d{17,20}$/;

/** Regex to find thread_id references in text. */
const THREAD_ID_TEXT_PATTERN = /thread[_-]?id["\s:=]+["']?(\d{17,20})/i;

/** Regex to find agent_name references in text. */
const AGENT_NAME_TEXT_PATTERN = /agent[_-]?name["\s:=]+["']?([a-zA-Z0-9_-]+)/i;

// ─── Config Reader ───────────────────────────────────────────────────────────

/**
 * Read KoordDaemon config from settings.json hookConfig.koordDaemon.
 * Returns null fields if not configured or on any read/parse error (fails open).
 *
 * Pattern: hooks/GitSafety/ProtectedBranchGuard/ProtectedBranchGuard.contract.ts:95-110
 */
export function readKoordConfig(
  readFileFn?: (path: string) => string | null,
  settingsPath?: string,
): KoordDaemonConfig {
  const cfg = readHookConfig<{ url?: string; prepromptPath?: string }>(
    "koordDaemon",
    readFileFn ?? undefined,
    settingsPath,
  );
  return {
    url: typeof cfg?.url === "string" ? cfg.url : null,
    prepromptPath: typeof cfg?.prepromptPath === "string" ? cfg.prepromptPath : null,
  };
}

// ─── Extraction Helpers ──────────────────────────────────────────────────────

/**
 * Extract a Discord thread ID from a tool_input object.
 * Checks explicit thread_id field first, then scans prompt text.
 */
export function extractThreadId(toolInput: Record<string, unknown>): string | null {
  // Check explicit thread_id field
  if (typeof toolInput.thread_id === "string" && DISCORD_ID_PATTERN.test(toolInput.thread_id)) {
    return toolInput.thread_id;
  }
  // Scan prompt text for thread_id references
  if (typeof toolInput.prompt === "string") {
    const match = toolInput.prompt.match(THREAD_ID_TEXT_PATTERN);
    if (match) return match[1];
  }
  return null;
}

/** Fields read by extractThreadIdFromOutput.
 *  All three fields are narrowed to string via typeof guards inside the function.
 *  ToolHookInput (core/types/hook-inputs.ts) is a structural superset of this type;
 *  callers with ToolHookInput should cast with `input as ThreadIdOutputInput` since
 *  ToolHookInput.tool_response is typed as unknown rather than string|object|null. */
export interface ThreadIdOutputInput {
  /** Discord snowflake ID, present at the top level on Stop events. */
  thread_id?: string;
  /** Raw output field name sent by Claude Code at runtime. */
  tool_output?: string | object | null;
  /** Typed response field used by hook contracts and tests. */
  tool_response?: string | object | null;
}

/**
 * Extract a thread ID from tool_output text (for completion detection).
 * Does NOT check tool_input — spawn-time params would cause false positives.
 *
 * Source logic: /Users/hogers/Projects/koord/.claude/hooks/AgentCompleteTracker.hook.js:123-136
 */
export function extractThreadIdFromOutput(input: ThreadIdOutputInput): string | null {
  // For Stop event: check top-level thread_id
  if (typeof input.thread_id === "string" && DISCORD_ID_PATTERN.test(input.thread_id)) {
    return input.thread_id;
  }
  // Check tool_output / tool_response text for thread_id references
  // Claude Code sends tool_response in typed input (core/types/hook-inputs.ts:29),
  // but raw JS hooks historically used tool_output — check both for compatibility.
  const output = input.tool_output ?? input.tool_response;
  if (typeof output === "string") {
    const match = output.match(THREAD_ID_TEXT_PATTERN);
    if (match) return match[1];
  }
  return null;
}

/**
 * Extract agent name from tool_input. Checks name field, then prompt text.
 */
export function extractAgentName(toolInput: Record<string, unknown>): string | null {
  if (typeof toolInput.name === "string" && toolInput.name.trim()) {
    return toolInput.name.trim();
  }
  if (typeof toolInput.prompt === "string") {
    const match = toolInput.prompt.match(AGENT_NAME_TEXT_PATTERN);
    if (match) return match[1];
  }
  return null;
}

/**
 * Extract task description from tool_input. Checks task_description field,
 * then uses first line of prompt as fallback.
 */
export function extractTask(toolInput: Record<string, unknown>): string | null {
  if (typeof toolInput.task_description === "string") {
    return toolInput.task_description.slice(0, 200);
  }
  if (typeof toolInput.prompt === "string") {
    const firstLine = toolInput.prompt.split("\n")[0].trim();
    return firstLine.slice(0, 200);
  }
  return null;
}

// ─── Message Queue Paths ────────────────────────────────────────────────────

const MQ_BASE_DIR = "/tmp/pai-mq";

/** Root queue directory for a session: /tmp/pai-mq/{sessionId} */
export function getQueueDir(sessionId: string): string {
  return `${MQ_BASE_DIR}/${sessionId}`;
}

/** Messages directory: /tmp/pai-mq/{sessionId}/messages/ */
export function getMessagesDir(sessionId: string): string {
  return `${MQ_BASE_DIR}/${sessionId}/messages`;
}

/** Port file written by mq-server: /tmp/pai-mq/{sessionId}/port */
export function getPortFile(sessionId: string): string {
  return `${MQ_BASE_DIR}/${sessionId}/port`;
}

/** PID file written by mq-server: /tmp/pai-mq/{sessionId}/pid */
export function getPidFile(sessionId: string): string {
  return `${MQ_BASE_DIR}/${sessionId}/pid`;
}

/** Cursor file tracking next unread message index: /tmp/pai-mq/{sessionId}/cursor */
export function getCursorFile(sessionId: string): string {
  return `${MQ_BASE_DIR}/${sessionId}/cursor`;
}

/** Marker pattern in Bash commands to identify the watcher script. */
export const MQ_WATCHER_MARKER = "mq-watcher";

// ─── Shared Deps Helpers ─────────────────────────────────────────────────────

/** Default readFile-or-null for config reading, wrapping the fs adapter. */
export function defaultReadFileOrNull(path: string): string | null {
  const r = readFile(path);
  return r.ok ? r.value : null;
}
