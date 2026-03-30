/**
 * Shared tool input extraction utilities.
 *
 * These helpers extract common fields from ToolHookInput.tool_input.
 * Canonical location — all hooks should import from here rather than
 * redeclaring these inline.
 */

import type { ToolHookInput } from "@hooks/core/types/hook-inputs";

/** Extract file_path from tool_input. */
export function getFilePath(input: ToolHookInput): string | null {
  if (typeof input.tool_input !== "object" || input.tool_input === null) return null;
  return ((input.tool_input as Record<string, unknown>).file_path as string) ?? null;
}

/** Extract content from Write tool_input. */
export function getWriteContent(input: ToolHookInput): string | null {
  if (typeof input.tool_input !== "object" || input.tool_input === null) return null;
  return ((input.tool_input as Record<string, unknown>).content as string) ?? null;
}
