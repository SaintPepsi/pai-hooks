/**
 * Typed hook inputs for all eight Claude Code hook event types.
 */

// ─── Event Types ─────────────────────────────────────────────────────────────

export type HookEventType =
  | "PreToolUse"
  | "PostToolUse"
  | "SessionStart"
  | "SessionEnd"
  | "UserPromptSubmit"
  | "PreCompact"
  | "Stop"
  | "SubagentStart"
  | "SubagentStop"
  | "PermissionRequest";

// ─── Base Input ──────────────────────────────────────────────────────────────

export interface HookInputBase {
  session_id: string;
  hook_event_name?: string;
}

// ─── Tool Inputs (Pre/PostToolUse) ───────────────────────────────────────────

export interface ToolHookInput extends HookInputBase {
  tool_name: string;
  tool_input: Record<string, unknown>;
  /**
   * Tool response varies by tool (#181):
   * - String: serialized JSON from Claude Code runtime
   * - Object: parsed response in test fixtures or some tools
   * Use typeof check before accessing properties.
   */
  tool_response?: string | object;
  /**
   * Legacy alias for tool_response in raw Claude Code JSON (#161).
   * Some runtime versions emit tool_output instead of tool_response.
   * Hooks should check both fields.
   */
  tool_output?: string | object;
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
  user_prompt?: string; // Legacy field name
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
  last_assistant_message?: string;
  stop_hook_active?: boolean;
}

// ─── Subagent Lifecycle Inputs ────────────────────────────────────────────────

export interface SubagentStartInput extends HookInputBase {
  transcript_path?: string;
}

export interface SubagentStopInput extends HookInputBase {
  transcript_path?: string;
}

// ─── PermissionRequest Input ─────────────────────────────────────────────────

export interface PermissionRequestInput extends HookInputBase {
  tool_name: string;
  tool_input: Record<string, unknown>;
  permission_mode?: string;
  permission_suggestions?: Array<{
    type: string;
    rules: Array<{ toolName: string; ruleContent: string }>;
    behavior: string;
    destination: string;
  }>;
}

// ─── Union Type ──────────────────────────────────────────────────────────────

export type HookInput =
  | ToolHookInput
  | SessionStartInput
  | SessionEndInput
  | UserPromptSubmitInput
  | PreCompactInput
  | StopInput
  | SubagentStartInput
  | SubagentStopInput
  | PermissionRequestInput;
