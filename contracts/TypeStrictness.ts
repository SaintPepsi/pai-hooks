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

import type { SyncHookContract } from "@hooks/core/contract";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput, BlockOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { logSignal, defaultSignalLoggerDeps, type SignalLoggerDeps } from "@hooks/lib/signal-logger";
import { pickNarrative } from "@hooks/lib/narrative-reader";
import { isSvelteFile, extractSvelteScript } from "@hooks/lib/svelte-utils";

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
  return /\.tsx?$/.test(filePath) || isSvelteFile(filePath);
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

// ─── Lazy Unknown Detection ─────────────────────────────────────────────────

interface UnknownWarning {
  line: number;
  content: string;
  pattern: string;
}

/**
 * Patterns where `unknown` is legitimate and should NOT be flagged:
 * - catch (e: unknown) or catch (e) — error handling
 * - Type guard parameters: (value: unknown) => value is T
 * - JSON.parse result assignment (always returns unknown-ish data)
 * - Generic constraints: T extends unknown
 */
const UNKNOWN_EXEMPTIONS: RegExp[] = [
  /\bcatch\s*\(\s*\w+\s*(?::\s*unknown\s*)?\)/, // catch (e: unknown) or catch (e)
  /\)\s*(?::\s*\w+\s+is\s+)/, // type guard return: value is T
  /JSON\.parse\(/, // JSON.parse result
  /\bextends\s+unknown\b/, // generic constraint
  /\bPromise<unknown>/, // Promise<unknown> is often correct for generic async
  /\bRecord<string,\s*unknown>/, // Record<string, unknown> is the correct "any object" type
  /\bReadonlyArray<unknown>/, // ReadonlyArray<unknown> for typed-but-unspecified arrays
];

/** Detect bare `unknown` usage that looks like a lazy `any` replacement. */
export function findLazyUnknownUsage(content: string): UnknownWarning[] {
  const stripped = stripCommentsAndStrings(content);
  const originalLines = content.split("\n");
  const strippedLines = stripped.split("\n");
  const warnings: UnknownWarning[] = [];

  const UNKNOWN_PATTERNS: Array<{ regex: RegExp; description: string }> = [
    { regex: /:\s*unknown\b/, description: "bare `: unknown` annotation" },
    { regex: /\bas\s+unknown\b/, description: "bare `as unknown` assertion" },
    { regex: /\bunknown\s*\[\s*\]/, description: "bare `unknown[]` array" },
  ];

  for (let i = 0; i < strippedLines.length; i++) {
    const strippedLine = strippedLines[i];
    const originalLine = originalLines[i];

    for (const p of UNKNOWN_PATTERNS) {
      if (!p.regex.test(strippedLine)) continue;

      // Check exemptions against original line (needs string content for JSON.parse etc.)
      const isExempt = UNKNOWN_EXEMPTIONS.some(ex => ex.test(originalLine));
      if (isExempt) continue;

      warnings.push({
        line: i + 1,
        content: originalLine.trim(),
        pattern: p.description,
      });
      break;
    }
  }

  return warnings;
}

function formatLazyUnknownAdvisory(warnings: UnknownWarning[], filePath: string): string {
  const lines = warnings.map(
    (w) => `  Line ${w.line}: ${w.content}\n           → ${w.pattern}`
  );

  return [
    `⚠️ LAZY TYPE WARNING — ${warnings.length} bare \`unknown\` usage${warnings.length === 1 ? "" : "s"} in ${filePath}:`,
    "",
    ...lines,
    "",
    "Do not use `unknown` as a quick replacement for `any`. Take time to find the correct type:",
    "  1. Read the type definitions of imported modules — the correct type likely exists",
    "  2. Check call sites to understand what data shape is actually passed",
    "  3. Define a proper interface if the type doesn't exist yet",
    "  4. Only use `unknown` when the type is genuinely unknowable, with a type guard to narrow it",
    "",
    "Getting types right matters more than getting them fast.",
  ].join("\n");
}

// ─── Block Message ──────────────────────────────────────────────────────────

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
    "STOP. Do not just replace `any` with `unknown` — that is not a fix, it is a band-aid.",
    "",
    "Before writing any type replacement:",
    "  1. READ the type definitions of the modules you are importing",
    "  2. CHECK if the correct type is already exported from a dependency",
    "  3. DEFINE an interface if the data shape is known but untyped",
    "  4. Only use `unknown` as a LAST RESORT when the type is genuinely unknowable,",
    "     and ALWAYS pair it with a type guard that narrows before use",
    "",
    "Common correct fixes:",
    "  • `: any` on a function param  → read the call site, use the actual type",
    "  • `as any` for casting         → find the intermediate type, use `as IntermediateType`",
    "  • `<any>` in a generic         → use the concrete type the generic expects",
    "  • `catch (e: any)`             → `catch (e: unknown)` is correct here (exempted)",
    "",
    "Take the time to get this right. Type correctness > speed.",
  ].join("\n");
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: TypeStrictnessDeps = {
  signal: defaultSignalLoggerDeps,
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const TypeStrictness: SyncHookContract<
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
    let content = getNewContent(input);

    if (!content) {
      return ok({ type: "continue", continue: true });
    }

    // For Svelte files, only scan the <script lang="ts"> block
    if (isSvelteFile(filePath)) {
      const scriptContent = extractSvelteScript(content);
      if (!scriptContent) {
        return ok({ type: "continue", continue: true });
      }
      content = scriptContent;
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
      // No `any` violations — check for lazy `unknown` usage (advisory only)
      const unknownWarnings = findLazyUnknownUsage(content);
      if (unknownWarnings.length > 0) {
        const advisory = formatLazyUnknownAdvisory(unknownWarnings, filePath);
        deps.stderr(`[TypeStrictness] ${filePath}: ${unknownWarnings.length} lazy unknown warning(s)`);

        logSignal(deps.signal, "type-strictness.jsonl", {
          session_id: input.session_id,
          hook: "TypeStrictness",
          event: "PreToolUse",
          tool: input.tool_name,
          file: filePath,
          outcome: "continue",
          lazy_unknown_count: unknownWarnings.length,
        });

        return ok({
          type: "continue",
          continue: true,
          additionalContext: advisory,
        });
      }

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
