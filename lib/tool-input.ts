/**
 * Shared tool input extraction utilities.
 *
 * These helpers extract common fields from ToolHookInput.tool_input.
 * Canonical location — all hooks should import from here rather than
 * redeclaring these inline.
 */

import type { ToolHookInput } from "@hooks/core/types/hook-inputs";

// ─── Per-Tool Input Types (#160) ─────────────────────────────────────────────

/** Input shape for Write tool. */
export interface WriteToolInput {
  file_path: string;
  content: string;
}

/** Input shape for Edit tool. */
export interface EditToolInput {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

/** Input shape for Bash tool. */
export interface BashToolInput {
  command: string;
  timeout?: number;
  run_in_background?: boolean;
}

/** Input shape for Read tool. */
export interface ReadToolInput {
  file_path: string;
  offset?: number;
  limit?: number;
}

/** Input shape for Glob tool. */
export interface GlobToolInput {
  pattern: string;
  path?: string;
}

/** Input shape for Grep tool. */
export interface GrepToolInput {
  pattern: string;
  path?: string;
  glob?: string;
  type?: string;
}

// ─── Type Guards ─────────────────────────────────────────────────────────────

function hasStringField(obj: Record<string, unknown>, field: string): boolean {
  return typeof obj[field] === "string";
}

// ─── Extraction Functions ────────────────────────────────────────────────────

/** Extract file_path from tool_input. */
export function getFilePath(input: ToolHookInput): string | null {
  const ti = input.tool_input;
  if (typeof ti !== "object" || ti === null) return null;
  if (!hasStringField(ti, "file_path")) return null;
  return ti.file_path as string;
}

/** Extract command from Bash tool_input. */
export function getCommand(input: ToolHookInput): string {
  const ti = input.tool_input;
  if (typeof ti === "string") return ti;
  if (typeof ti !== "object" || ti === null) return "";
  if (!hasStringField(ti, "command")) return "";
  return ti.command as string;
}

/** Extract content from Write tool_input. */
export function getWriteContent(input: ToolHookInput): string | null {
  const ti = input.tool_input;
  if (typeof ti !== "object" || ti === null) return null;
  if (!hasStringField(ti, "content")) return null;
  return ti.content as string;
}
