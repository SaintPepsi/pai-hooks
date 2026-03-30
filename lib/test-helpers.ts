/**
 * Shared test helper factories for hook tests.
 *
 * Canonical location for ToolHookInput factories that were duplicated
 * across 40+ test files.
 */

import type { ToolHookInput } from "@hooks/core/types/hook-inputs";

/** Create a Write tool input for testing. */
export function makeWriteInput(filePath: string, content: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Write",
    tool_input: { file_path: filePath, content },
  };
}

/** Create an Edit tool input for testing. */
export function makeEditInput(
  filePath: string,
  oldString = "a",
  newString = "b",
): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Edit",
    tool_input: { file_path: filePath, old_string: oldString, new_string: newString },
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
