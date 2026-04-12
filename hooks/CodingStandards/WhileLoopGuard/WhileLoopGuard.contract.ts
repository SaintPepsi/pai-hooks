/**
 * WhileLoopGuard Contract — Block while and do...while loops in code files.
 *
 * PreToolUse hook that fires on Write and Edit to code files.
 * Uses state-checking: simulates the full file after the operation,
 * then checks for while loop syntax using comment-aware regex.
 *
 * Detection: strips comments and string literals, then matches \bwhile\b.
 * This catches while(), do...while(), and language variants (Python while cond:).
 *
 * Design note: AST-based detection (@swc/core) was considered but rejected
 * for this iteration — it would add ~40MB to a 1-dep repo and only covers
 * JS/TS. Comment-aware regex provides equivalent precision for literal
 * keyword detection. AST should be revisited if we need semantic analysis
 * (e.g., "loops without bounded conditions").
 */

import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readFile as adapterReadFile } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { defaultStderr } from "@hooks/lib/paths";
import { getFilePath } from "@hooks/lib/tool-input";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WhileLoopGuardDeps {
  readFile: (path: string) => string | null;
  stderr: (msg: string) => void;
}

// ─── Pure Functions ──────────────────────────────────────────────────────────

const CODE_EXTENSIONS =
  /\.(ts|tsx|js|jsx|mts|mjs|svelte|php|py|go|rs|vue|rb|java|kt|swift|c|cpp|cs)$/;

/** Extensions where # starts a single-line comment. */
const HASH_COMMENT_EXTENSIONS = /\.(py|rb|php)$/;

/**
 * Strip C-style comments (// and /* *​/) and string literals
 * (template, double-quoted, single-quoted) to avoid false positives.
 *
 * Note: [^"\\] in the string patterns matches newlines, so multi-line
 * strings (including Python triple-quotes when parsed as consecutive
 * empty + content strings) are handled by the base regex.
 */
function stripCStyleCommentsAndStrings(code: string): string {
  return code.replace(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g,
    " ",
  );
}

/** Strip # single-line comments for Python, Ruby, PHP. */
function stripHashComments(code: string): string {
  return code.replace(/#[^\n]*/g, " ");
}

/** Full comment/string stripping, language-aware for # comments. */
function stripCommentsAndStrings(code: string, filePath: string): string {
  let stripped = stripCStyleCommentsAndStrings(code);
  if (HASH_COMMENT_EXTENSIONS.test(filePath)) {
    stripped = stripHashComments(stripped);
  }
  return stripped;
}

/** Detect while/do...while syntax in stripped code. */
function containsWhileLoop(strippedCode: string): boolean {
  return /\bwhile\b/.test(strippedCode);
}

function getWriteContent(input: ToolHookInput): string | null {
  if (typeof input.tool_input !== "object" || input.tool_input === null) return null;
  return (input.tool_input.content as string) ?? null;
}

function getEditParts(
  input: ToolHookInput,
): { oldStr: string; newStr: string; replaceAll: boolean } | null {
  if (typeof input.tool_input !== "object" || input.tool_input === null) return null;
  if (input.tool_name !== "Edit") return null;
  const oldStr = input.tool_input.old_string as string | undefined;
  const newStr = input.tool_input.new_string as string | undefined;
  if (!oldStr || !newStr) return null;
  const replaceAll = (input.tool_input.replace_all as boolean) ?? false;
  return { oldStr, newStr, replaceAll };
}

function applyEdit(
  fileContent: string,
  oldStr: string,
  newStr: string,
  replaceAll: boolean,
): string {
  if (replaceAll) {
    return fileContent.split(oldStr).join(newStr);
  }
  return fileContent.replace(oldStr, newStr);
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: WhileLoopGuardDeps = {
  readFile: (path: string): string | null => {
    const result = adapterReadFile(path);
    return result.ok ? result.value : null;
  },
  stderr: defaultStderr,
};

export const WhileLoopGuard: SyncHookContract<ToolHookInput, WhileLoopGuardDeps> = {
  name: "WhileLoopGuard",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    if (input.tool_name !== "Write" && input.tool_name !== "Edit") return false;
    const filePath = getFilePath(input);
    if (!filePath) return false;
    return CODE_EXTENSIONS.test(filePath);
  },

  execute(input: ToolHookInput, deps: WhileLoopGuardDeps): Result<SyncHookJSONOutput, ResultError> {
    const filePath = getFilePath(input)!;

    let contentToCheck: string | null = null;

    if (input.tool_name === "Write") {
      contentToCheck = getWriteContent(input);
    } else if (input.tool_name === "Edit") {
      const editParts = getEditParts(input);
      if (!editParts) {
        return ok({ continue: true });
      }

      const currentFile = deps.readFile(filePath);
      if (currentFile !== null) {
        contentToCheck = applyEdit(
          currentFile,
          editParts.oldStr,
          editParts.newStr,
          editParts.replaceAll,
        );
      } else {
        contentToCheck = editParts.newStr;
      }
    }

    if (!contentToCheck) {
      return ok({ continue: true });
    }

    const stripped = stripCommentsAndStrings(contentToCheck, filePath);

    if (containsWhileLoop(stripped)) {
      const reason = [
        "While loops are banned.",
        "",
        `File: ${filePath}`,
        "",
        "The resulting file contains a while or do...while loop.",
        "Use a deterministic alternative:",
        "  - for loop with known bounds",
        "  - for...of over collections",
        "  - Array methods (.map, .filter, .reduce, .forEach)",
        "  - Recursion with a depth limit",
        "  - for (let i = 0; i < MAX; i++) { if (done) break; } for uncertain termination",
        "",
        "See steering rule 'No While Loops' in USER/AISTEERINGRULES.md.",
      ].join("\n");

      deps.stderr(reason);

      return ok({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      });
    }

    return ok({ continue: true });
  },

  defaultDeps,
};
