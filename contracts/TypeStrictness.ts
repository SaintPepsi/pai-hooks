/**
 * TypeStrictness Contract — Block `any` types in TypeScript files.
 *
 * PreToolUse hook that fires on Edit and Write operations targeting
 * .ts/.tsx files. Scans the new content for TypeScript `any` type
 * usage and hard-blocks with specific line numbers and fix guidance.
 *
 * Detection: strips comments, string literals, and regex literals,
 * then matches type annotation patterns (`: any`, `as any`, generic `<any>`, `any[]`).
 */

import type { HookContract } from "@hooks/core/contract";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput, BlockOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { logSignal, defaultSignalLoggerDeps, type SignalLoggerDeps } from "@hooks/lib/signal-logger";
import { pickNarrative } from "@hooks/lib/narrative-reader";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AnyViolation {
  line: number;
  content: string;
  pattern: string;
}

export interface TypeStrictnessDeps {
  signal: SignalLoggerDeps;
  stderr: (msg: string) => void;
}

// ─── Pure Logic ──────────────────────────────────────────────────────────────

/** Strip single-line comments, multi-line comments, string literals, and regex literals. */
export function stripCommentsAndStrings(code: string): string {
  return code
    // Multi-line comments
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
    // Single-line comments
    .replace(/\/\/.*$/gm, (match) => " ".repeat(match.length))
    // Template literals (simplified — handles single-line)
    .replace(/`[^`]*`/g, (match) => match.replace(/[^\n]/g, " "))
    // Double-quoted strings
    .replace(/"(?:[^"\\]|\\.)*"/g, (match) => " ".repeat(match.length))
    // Single-quoted strings
    .replace(/'(?:[^'\\]|\\.)*'/g, (match) => " ".repeat(match.length))
    // Regex literals (e.g., /pattern/flags)
    .replace(/\/(?:[^/\\]|\\.)+\/[gimsuy]*/g, (match) => " ".repeat(match.length));
}

/**
 * The `any` type patterns in TypeScript:
 *
 * `: any`     — type annotation (param, return, variable, property)
 * `as any`    — type assertion
 * `<any>`     — generic parameter or old-style assertion
 * `<any,`     — first of multiple generic params
 * `, any>`    — last generic param
 * `, any,`    — middle generic param
 * `any[]`     — array type
 * `any |`     — union type start
 * `| any`     — union type continuation
 * `any &`     — intersection type start
 * `& any`     — intersection type continuation
 */
const ANY_TYPE_PATTERNS: Array<{ regex: RegExp; description: string }> = [
  { regex: /:\s*any\b/, description: "type annotation `: any`" },
  { regex: /\bas\s+any\b/, description: "type assertion `as any`" },
  { regex: /[<,]\s*any\s*[>,\]]/, description: "generic parameter `<any>`" },
  { regex: /\bany\s*\[\s*\]/, description: "array type `any[]`" },
  { regex: /[|&]\s*any\b/, description: "union/intersection `| any`" },
  { regex: /\bany\s*[|&]/, description: "union/intersection `any |`" },
];

/** Scan a single line (already stripped of comments/strings) for any-type usage. */
export function detectAnyOnLine(strippedLine: string): { found: boolean; pattern: string } {
  for (const p of ANY_TYPE_PATTERNS) {
    if (p.regex.test(strippedLine)) {
      return { found: true, pattern: p.description };
    }
  }
  return { found: false, pattern: "" };
}

/** Scan content for all `any` type violations. Returns violations with line numbers. */
export function findAnyViolations(content: string): AnyViolation[] {
  const originalLines = content.split("\n");
  const stripped = stripCommentsAndStrings(content);
  const strippedLines = stripped.split("\n");
  const violations: AnyViolation[] = [];

  for (let i = 0; i < strippedLines.length; i++) {
    const result = detectAnyOnLine(strippedLines[i]);
    if (result.found) {
      violations.push({
        line: i + 1,
        content: originalLines[i].trim(),
        pattern: result.pattern,
      });
    }
  }

  return violations;
}

function isTypeScriptFile(filePath: string): boolean {
  return /\.tsx?$/.test(filePath);
}

function getNewContent(input: ToolHookInput): string | null {
  if (typeof input.tool_input !== "object" || input.tool_input === null) return null;

  // Write tool: full file content
  if (input.tool_name === "Write") {
    return (input.tool_input.content as string) ?? null;
  }

  // Edit tool: new_string (the replacement text)
  if (input.tool_name === "Edit") {
    return (input.tool_input.new_string as string) ?? null;
  }

  return null;
}

function getFilePath(input: ToolHookInput): string | null {
  if (typeof input.tool_input !== "object" || input.tool_input === null) return null;
  return (input.tool_input.file_path as string) ?? null;
}

function formatBlockMessage(violations: AnyViolation[], filePath: string): string {
  const lines = violations.map(
    (v) => `  Line ${v.line}: ${v.content}\n           → ${v.pattern}`
  );

  const opener = pickNarrative("TypeStrictness", violations.length);
  return [
    opener,
    "",
    `${violations.length} \`any\` type violation${violations.length === 1 ? "" : "s"} in ${filePath}:`,
    "",
    ...lines,
    "",
    "Fix: Replace `any` with proper types:",
    "  • `: any`  → `: unknown` (safe) or the actual type",
    "  • `as any` → `as unknown` or proper type narrowing",
    "  • `<any>`  → `<unknown>` or the actual generic type",
    "  • `any[]`  → `unknown[]` or typed array",
    "",
    "`unknown` is type-safe: it forces you to narrow before use.",
    "`any` disables ALL type checking — it is never acceptable.",
  ].join("\n");
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: TypeStrictnessDeps = {
  signal: defaultSignalLoggerDeps,
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const TypeStrictness: HookContract<
  ToolHookInput,
  ContinueOutput | BlockOutput,
  TypeStrictnessDeps
> = {
  name: "TypeStrictness",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    if (input.tool_name !== "Edit" && input.tool_name !== "Write") return false;
    const filePath = getFilePath(input);
    if (!filePath) return false;
    return isTypeScriptFile(filePath);
  },

  execute(
    input: ToolHookInput,
    deps: TypeStrictnessDeps,
  ): Result<ContinueOutput | BlockOutput, PaiError> {
    const filePath = getFilePath(input)!;
    const content = getNewContent(input);

    if (!content) {
      return ok({ type: "continue", continue: true });
    }

    const violations = findAnyViolations(content);
    const outcome = violations.length === 0 ? "continue" : "block";

    // Log every execution to JSONL for analysis
    logSignal(deps.signal, "type-strictness.jsonl", {
      session_id: input.session_id,
      hook: "TypeStrictness",
      event: "PreToolUse",
      tool: input.tool_name,
      file: filePath,
      outcome,
      ...(violations.length > 0 && {
        violations: violations.map(v => ({
          line: v.line,
          content: v.content,
          pattern: v.pattern,
        })),
      }),
    });

    if (violations.length === 0) {
      deps.stderr(`[TypeStrictness] ${filePath}: clean`);
      return ok({ type: "continue", continue: true });
    }

    const message = formatBlockMessage(violations, filePath);
    deps.stderr(message);

    return ok({
      type: "block",
      decision: "block",
      reason: message,
    });
  },

  defaultDeps,
};
