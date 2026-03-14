/**
 * Typed hook inputs for all six Claude Code hook event types.
 */

// ─── Event Types ─────────────────────────────────────────────────────────────

export type HookEventType =
  | "PreToolUse"
  | "PostToolUse"
  | "SessionStart"
  | "SessionEnd"
  | "UserPromptSubmit"
  | "PreCompact"
  | "Stop";

// ─── Base Input ──────────────────────────────────────────────────────────────

export interface HookInputBase {
  session_id: string;
}

// ─── Tool Inputs (Pre/PostToolUse) ───────────────────────────────────────────

export interface ToolHookInput extends HookInputBase {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response?: unknown;
}

// ─── Session Inputs ──────────────────────────────────────────────────────────

export interface SessionStartInput extends HookInputBase {
  // SessionStart receives minimal data
}

export interface SessionEndInput extends HookInputBase {
  transcript_path?: string;
}

// ─── Prompt Submit Input ─────────────────────────────────────────────────────

export interface UserPromptSubmitInput extends HookInputBase {
  prompt?: string;
  user_prompt?: string;       // Legacy field name
  transcript_path?: string;
}

// ─── PreCompact Input ────────────────────────────────────────────────────────

export interface PreCompactInput extends HookInputBase {
  // PreCompact fires before context compaction with no tool context
  trigger?: string;
}

// ─── Stop Input ──────────────────────────────────────────────────────────────

export interface StopInput extends HookInputBase {
  transcript_path?: string;
}

// ─── Union Type ──────────────────────────────────────────────────────────────

export type HookInput =
  | ToolHookInput
  | SessionStartInput
  | SessionEndInput
  | UserPromptSubmitInput
  | PreCompactInput
  | StopInput;
