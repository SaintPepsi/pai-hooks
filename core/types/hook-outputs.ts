/**
 * Typed hook outputs replacing ad-hoc JSON construction.
 *
 * Each output type maps to a specific stdout shape that Claude Code expects.
 */

// ─── Continue (most common — tool allowed to proceed) ────────────────────────

export interface ContinueOutput {
  type: "continue";
  continue: true;
  additionalContext?: string;
}

// ─── Block (PreToolUse — tool call rejected) ─────────────────────────────────

export interface BlockOutput {
  type: "block";
  decision: "block";
  reason: string;
}

// ─── Ask (PreToolUse — ask user for confirmation) ────────────────────────────

export interface AskOutput {
  type: "ask";
  decision: "ask";
  message: string;
}

// ─── Context (SessionStart, UserPromptSubmit — inject text into context) ─────

export interface ContextOutput {
  type: "context";
  content: string;
}

// ─── Silent (Stop, some SessionEnd — no stdout needed) ───────────────────────

export interface SilentOutput {
  type: "silent";
}

// ─── Union ───────────────────────────────────────────────────────────────────

export type HookOutput =
  | ContinueOutput
  | BlockOutput
  | AskOutput
  | ContextOutput
  | SilentOutput;

// ─── Factories ───────────────────────────────────────────────────────────────

export function continueOk(additionalContext?: string): ContinueOutput {
  const output: ContinueOutput = { type: "continue", continue: true };
  if (additionalContext !== undefined) output.additionalContext = additionalContext;
  return output;
}

export function block(reason: string): BlockOutput {
  return { type: "block", decision: "block", reason };
}

export function ask(message: string): AskOutput {
  return { type: "ask", decision: "ask", message };
}

export function context(content: string): ContextOutput {
  return { type: "context", content };
}

export function silent(): SilentOutput {
  return { type: "silent" };
}
