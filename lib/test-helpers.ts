/**
 * Shared test helper factories for hook tests.
 *
 * Canonical location for ToolHookInput factories that were duplicated
 * across 40+ test files.
 */

import { join } from "node:path";
import type { HookEvent, SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { removeDir } from "@hooks/core/adapters/fs";
import { buildChildEnv } from "@hooks/core/adapters/process";
import type { SessionStartInput, ToolHookInput } from "@hooks/core/types/hook-inputs";

/**
 * Narrow SyncHookJSONOutput to additionalContext for a specific hookEventName.
 * Returns undefined when the output has no hookSpecificOutput or when the event
 * name does not match. Use for any R2/R7 context-injection assertion.
 */
export function getInjectedContextFor(
  output: SyncHookJSONOutput,
  eventName: HookEvent,
): string | undefined {
  const hs = output.hookSpecificOutput;
  if (!hs || hs.hookEventName !== eventName) return undefined;
  return "additionalContext" in hs ? hs.additionalContext : undefined;
}

/** Create a Write tool input for testing. */
export function makeWriteInput(filePath: string, content: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Write",
    tool_input: { file_path: filePath, content },
  };
}

/** Create an Edit tool input for testing. */
export function makeEditInput(filePath: string, oldString = "a", newString = "b"): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Edit",
    tool_input: {
      file_path: filePath,
      old_string: oldString,
      new_string: newString,
    },
  };
}

/** Create a generic tool input for testing. */
export function makeToolInput(toolName: string, filePath: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: toolName,
    tool_input: { file_path: filePath },
  };
}

/** Create a SessionStart input for testing. */
export function makeSessionStartInput(sessionId = "test-sess"): SessionStartInput {
  return { session_id: sessionId };
}

// ─── Hook Shell Runner ───────────────────────────────────────────────────────

let _hookRunId = 0;

/** Generate a unique session ID for hook shell tests. */
export function uniqueSessionId(base: string): string {
  return `${base}-${Date.now()}-${++_hookRunId}`;
}

/** Spawn a hook script with JSON stdin and capture stdout/stderr/exitCode.
 *  Sets PAI_DIR to a temp directory so hooks don't pollute the real filesystem. */
export async function runHookScript(
  hookPath: string,
  input: Record<string, unknown>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const tmpDir = join(import.meta.dir, `__hook-test-${Date.now()}-${++_hookRunId}__`);
  const proc = Bun.spawn(["bun", hookPath], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: buildChildEnv({ PAI_DIR: tmpDir }),
  });
  const writer = proc.stdin!;
  writer.write(JSON.stringify(input));
  writer.end();
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  removeDir(tmpDir);
  return { stdout: stdout.trim(), stderr, exitCode };
}
