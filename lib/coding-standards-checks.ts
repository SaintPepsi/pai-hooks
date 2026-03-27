/**
 * Coding Standards Violation Detection — Shared Pure Functions
 *
 * Pure string analysis functions for detecting coding standard violations
 * in TypeScript files. No I/O, no dependencies, no side effects.
 *
 * Used by:
 *   - CodingStandardsEnforcer (PreToolUse Edit/Write — blocks violations)
 *   - CodingStandardsAdvisor  (PostToolUse Read — advises on violations)
 */

import { SKIP_FILENAMES } from "@hooks/core/language-profiles";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Violation {
  line: number;
  content: string;
  category: "raw-import" | "try-catch" | "process-env" | "inline-import-type" | "as-any" | "relative-import" | "export-default";
  message: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Check if a line is a comment (single-line or inside a block comment). */
export function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

/** Check if a line (or the preceding line) contains @codingstandard-exempt. */
export function isExempted(lines: string[], index: number): boolean {
  const current = lines[index];
  if (current && current.includes("@codingstandard-exempt")) return true;
  if (index > 0) {
    const prev = lines[index - 1];
    if (prev && prev.includes("@codingstandard-exempt")) return true;
  }
  return false;
}

/** Strip string literal contents so pattern matching doesn't false-positive on message text. */
export function stripStringLiterals(line: string): string {
  return line.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''").replace(/`[^`]*`/g, "``");
}

// ─── Patterns ────────────────────────────────────────────────────────────────

export const RAW_BUILTIN_PATTERNS: ReadonlyArray<{ regex: RegExp; module: string }> = [
  { regex: /^\s*import\b.*from\s+["']fs["']/, module: "fs" },
  { regex: /^\s*import\b.*from\s+["']node:fs["']/, module: "node:fs" },
  { regex: /^\s*import\b.*from\s+["']fs\/promises["']/, module: "fs/promises" },
  { regex: /^\s*import\b.*from\s+["']child_process["']/, module: "child_process" },
  { regex: /^\s*import\b.*from\s+["']node:child_process["']/, module: "node:child_process" },
  { regex: /^\s*import\b.*from\s+["']http["']/, module: "http" },
  { regex: /^\s*import\b.*from\s+["']https["']/, module: "https" },
  { regex: /^\s*import\b.*from\s+["']crypto["']/, module: "crypto" },
];

// ─── Violation Finders ───────────────────────────────────────────────────────

/** Detect raw Node builtin imports. */
export function findRawImports(lines: string[]): Violation[] {
  const violations: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i]) || isExempted(lines, i)) continue;
    for (const pattern of RAW_BUILTIN_PATTERNS) {
      if (pattern.regex.test(lines[i])) {
        violations.push({
          line: i + 1,
          content: lines[i].trim(),
          category: "raw-import",
          message: `Raw "${pattern.module}" import. Use an adapters/ wrapper instead.`,
        });
        break;
      }
    }
  }
  return violations;
}

/** Detect try-catch blocks used for flow control. */
export function findTryCatchFlowControl(lines: string[]): Violation[] {
  const violations: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i]) || isExempted(lines, i)) continue;
    if (/^\s*try\s*\{/.test(lines[i])) {
      violations.push({
        line: i + 1,
        content: lines[i].trim(),
        category: "try-catch",
        message: "Try-catch for flow control. Use explicit error returns instead.",
      });
    }
  }
  return violations;
}

/** Detect direct env access outside defaultDeps. Strips string literals to avoid false positives. */
export function findDirectEnvAccess(content: string, lines: string[]): Violation[] {
  const violations: Violation[] = [];

  let inDefaultDeps = false;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track entry into defaultDeps block
    if (/\bdefaultDeps\b.*[={]/.test(line)) {
      inDefaultDeps = true;
    }

    if (inDefaultDeps) {
      for (const ch of line) {
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }
      if (braceDepth <= 0) {
        inDefaultDeps = false;
        braceDepth = 0;
      }
    }

    // Skip comments, defaultDeps blocks, exempted lines, and lines where env access is only in strings
    if (inDefaultDeps || isCommentLine(line) || isExempted(lines, i)) continue;

    // Strip string literals so "process.env" inside error messages doesn't trigger
    const stripped = stripStringLiterals(line);
    if (!/\bprocess\.env\b/.test(stripped)) continue;

    // Allow const declarations that feed into defaultDeps
    if (/^\s*const\s+\w+.*=\s*process\.env\b/.test(stripped)) {
      const varMatch = line.match(/^\s*const\s+(\w+)/);
      if (varMatch && content.includes("defaultDeps") && content.includes(varMatch[1])) {
        continue;
      }
    }

    violations.push({
      line: i + 1,
      content: line.trim(),
      category: "process-env",
      message: "Direct env access. Inject via Deps interface + defaultDeps.",
    });
  }
  return violations;
}

/** Detect inline import types used in type positions (not runtime dynamic imports). */
export function findInlineImportTypes(lines: string[]): Violation[] {
  const violations: Violation[] = [];
  const INLINE_IMPORT_TYPE = /import\(['"`][^'"`]+['"`]\)\.\w+/;

  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i]) || isExempted(lines, i)) continue;

    // Check original line (path content is inside quotes, must not be stripped).
    // Remove legitimate runtime dynamic imports before matching.
    const withoutAwaitImports = lines[i].replace(/\bawait\s+import\([^)]*\)/g, "__RUNTIME_IMPORT__");

    if (INLINE_IMPORT_TYPE.test(withoutAwaitImports)) {
      violations.push({
        line: i + 1,
        content: lines[i].trim(),
        category: "inline-import-type",
        message: "Inline import type. Use a top-level import type declaration instead.",
      });
    }
  }
  return violations;
}

/** Detect `as any` casts. Use `as unknown as ConcreteType` instead. */
export function findAsAnyCasts(lines: string[]): Violation[] {
  const violations: Violation[] = [];
  const AS_ANY = /\bas\s+any\b/;

  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i]) || isExempted(lines, i)) continue;

    const stripped = stripStringLiterals(lines[i]);
    if (AS_ANY.test(stripped)) {
      violations.push({
        line: i + 1,
        content: lines[i].trim(),
        category: "as-any",
        message: "as any cast. Use `as unknown as ConcreteType` or fix the type properly.",
      });
    }
  }
  return violations;
}

/** Detect relative imports (./  or ../ paths). Use non-relative path aliases instead. */
export function findRelativeImports(lines: string[], filePath?: string): Violation[] {
  const violations: Violation[] = [];

  // Test files legitimately import the module they test from the same directory
  const isTestFile = filePath && /\.(test|spec)\.(ts|tsx)$/.test(filePath);

  // Matches: from './..', from "../..", import('./..'), import("../.."), require('./..'), require("../..")
  // Note: checks original line (not stripped) because the import path IS the string content we need to inspect.
  const RELATIVE_FROM = /\bfrom\s+['"]\.\.?\//;
  const RELATIVE_DYNAMIC = /\bimport\(\s*['"]\.\.?\//;
  const RELATIVE_REQUIRE = /\brequire\(\s*['"]\.\.?\//;
  // SvelteKit convention: ./$types is auto-generated per-route, must be imported relatively
  const DOLLAR_PREFIX_IMPORT = /\bfrom\s+['"]\.\/\$/;
  // Svelte convention: sibling component imports use relative paths with .svelte extension
  const SVELTE_COMPONENT_IMPORT = /\bfrom\s+['"][^'"]*\.svelte['"]/;

  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i]) || isExempted(lines, i)) continue;

    const line = lines[i];
    if (DOLLAR_PREFIX_IMPORT.test(line)) continue;
    // Svelte components are imported relatively by convention — exempt .svelte imports
    if (SVELTE_COMPONENT_IMPORT.test(line)) continue;
    // Test files: exempt same-directory imports (./module) but still catch parent traversals (../foo)
    if (isTestFile && /\bfrom\s+['"]\.\//.test(line)) continue;
    if (RELATIVE_FROM.test(line) || RELATIVE_DYNAMIC.test(line) || RELATIVE_REQUIRE.test(line)) {
      violations.push({
        line: i + 1,
        content: line.trim(),
        category: "relative-import",
        message: "Relative import path. Use non-relative path aliases (configure tsconfig paths).",
      });
    }
  }
  return violations;
}

/** Detect export default statements. Named exports only. */
export function findExportDefaults(lines: string[], filePath?: string): Violation[] {
  // Config files use export default by framework convention
  if (filePath && /\.config\.(ts|js|mts|mjs)$/.test(filePath)) return [];
  // SpacetimeDB schema requires export default for `spacetime generate` CLI
  if (filePath && /spacetimedb\/src\/index\.ts$/.test(filePath)) return [];
  // Svelte components use implicit default exports by framework convention
  if (filePath && /\.svelte$/.test(filePath)) return [];
  // Storybook config files require default exports by framework convention
  if (filePath && /\/\.storybook\//.test(filePath)) return [];

  const violations: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i]) || isExempted(lines, i)) continue;
    const stripped = stripStringLiterals(lines[i]);
    if (/\bexport\s+default\b/.test(stripped)) {
      violations.push({
        line: i + 1,
        content: lines[i].trim(),
        category: "export-default",
        message: "Default export. Use named exports: `export { name }` or `export const name`.",
      });
    }
  }
  return violations;
}

// ─── File Classification ─────────────────────────────────────────────────────

export function isTypeScriptFile(filePath: string): boolean {
  return /\.tsx?$/.test(filePath) || /\.svelte$/.test(filePath);
}

export function isSkippedFilename(filePath: string): boolean {
  const basename = filePath.split("/").pop() ?? "";
  return SKIP_FILENAMES.has(basename);
}

export function isAdapterFile(filePath: string): boolean {
  // Any file in an adapters/ directory (PAI or non-PAI projects)
  if (/\/adapters\//.test(filePath)) return true;
  // Single adapter files: adapters.ts, adapter.ts, adapters.tsx, adapter.tsx
  if (/\/adapters?\.tsx?$/.test(filePath)) return true;
  // Hook infrastructure: core/ contains the runner and adapters that legitimately wrap builtins
  if (/\/hooks\/core\//.test(filePath)) return true;
  // Standalone modules outside tsconfig scope that use their own internal imports
  if (/\/statusline\//.test(filePath)) return true;
  return false;
}

/** Directories containing auto-generated code that cannot conform to coding standards. */
const AUTO_GENERATED_DIRS = [
  /\/module_bindings\//, // SpacetimeDB auto-generated bindings
  /\/spacetimedb\//, // SpacetimeDB server module — standalone package, no path aliases
];

export function isAutoGeneratedFile(filePath: string): boolean {
  return AUTO_GENERATED_DIRS.some(pattern => pattern.test(filePath));
}

// ─── Convenience ─────────────────────────────────────────────────────────────

/** Run all violation checks on file content. Returns combined violations array. */
export function findAllViolations(content: string, filePath?: string): Violation[] {
  const lines = content.split("\n");
  return [
    ...findRawImports(lines),
    ...findTryCatchFlowControl(lines),
    ...findDirectEnvAccess(content, lines),
    ...findInlineImportTypes(lines),
    ...findAsAnyCasts(lines),
    ...findRelativeImports(lines, filePath),
    ...findExportDefaults(lines, filePath),
  ];
}

const FIX_INSTRUCTIONS: Record<string, string> = {
  "raw-import": "Create or use an adapters layer for Node builtins",
  "try-catch": "Replace try-catch with Result<T> error returns",
  "process-env": "Move environment access into a Deps interface + defaultDeps",
  "inline-import-type": "Replace inline import types with top-level import type declarations",
  "as-any": "Replace unsafe type casts with proper types or unknown intermediate",
  "relative-import": "Replace relative imports with non-relative path aliases",
  "export-default": "Use named exports instead of export default",
};

/** Return numbered fix instructions only for categories that have violations. */
function fixInstructions(grouped: Record<string, Violation[]>): string[] {
  let n = 0;
  const lines: string[] = [];
  for (const [category, instruction] of Object.entries(FIX_INSTRUCTIONS)) {
    if (grouped[category]?.length) {
      n++;
      lines.push(`${n}. ${instruction}`);
    }
  }
  return lines;
}

/** Format a concise violation summary for advisory context injection. */
export function formatViolationSummary(violations: Violation[], filePath: string): string {
  const grouped: Record<string, Violation[]> = {};
  for (const v of violations) {
    (grouped[v.category] ??= []).push(v);
  }

  const parts: string[] = [];
  if (grouped["raw-import"]?.length) {
    const modules = grouped["raw-import"].map(v => v.content.match(/from\s+["']([^"']+)["']/)?.[1] ?? "unknown");
    parts.push(`${grouped["raw-import"].length}x raw Node builtin imports (${modules.join(", ")})`);
  }
  if (grouped["try-catch"]?.length) {
    parts.push(`${grouped["try-catch"].length}x try-catch flow control`);
  }
  if (grouped["process-env"]?.length) {
    parts.push(`${grouped["process-env"].length}x direct process.env access outside defaultDeps`);
  }
  if (grouped["inline-import-type"]?.length) {
    parts.push(`${grouped["inline-import-type"].length}x inline import type (use import type declaration)`);
  }
  if (grouped["as-any"]?.length) {
    parts.push(grouped["as-any"].length + "x unsafe type cast (use proper types)");
  }
  if (grouped["relative-import"]?.length) {
    parts.push(`${grouped["relative-import"].length}x relative import path`);
  }
  if (grouped["export-default"]?.length) {
    parts.push(`${grouped["export-default"].length}x default export (use named exports)`);
  }

  return [
    `⚠️ CODING STANDARDS — PRE-EXISTING VIOLATIONS (your edit WILL be blocked if these remain)`,
    `${filePath} has ${violations.length} violation${violations.length === 1 ? "" : "s"}:`,
    ...parts.map(p => `- ${p}`),
    "",
    "An enforcer hook checks the FULL file state after your edit. If ANY violation remains, your edit will be rejected.",
    "You are expected to fix these violations as part of your edit. This is not extra work — it is the coding standard.",
    "Include the violation fixes in the SAME edit that makes your intended change.",
    "",
    "Required fixes:",
    ...fixInstructions(grouped),
  ].join("\n");
}
