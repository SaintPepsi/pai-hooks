/**
 * TypeCheckVerifier Contract — Advisory type-checking after Edit/Write.
 *
 * PostToolUse hook that fires after Edit and Write operations on
 * .ts/.tsx/.svelte files. Discovers the project's type-check command
 * (svelte-check, tsc --noEmit, etc.), runs it, and injects any type
 * errors for the edited file as advisory context.
 *
 * Never blocks. Debounced per file (60s). Times out after 10s.
 */

import { dirname, join } from "node:path";
import { fileExists, readFile } from "@hooks/core/adapters/fs";
import { spawnSyncSafe } from "@hooks/core/adapters/process";
import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { getFilePath } from "@hooks/lib/tool-input";
import { continueOk } from "@hooks/core/types/hook-outputs";
import { defaultStderr } from "@hooks/lib/paths";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";
import {
  defaultSignalLoggerDeps,
  logSignal,
  type SignalLoggerDeps,
} from "@hooks/lib/signal-logger";
import { isSvelteFile } from "@hooks/lib/svelte-utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TypeCheckCommand {
  cmd: string;
  args: string[];
  cwd: string;
}

interface TypeCheckError {
  file: string;
  line: number;
  col: number;
  message: string;
}

export interface TypeCheckVerifierDeps {
  fileExists: (path: string) => boolean;
  readFile: (path: string) => string | null;
  execWithTimeout: (cmd: string, args: string[], cwd: string, timeoutMs: number) => ExecResult;
  signal: SignalLoggerDeps;
  stderr: (msg: string) => void;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

// ─── Debounce Cache ─────────────────────────────────────────────────────────

const lastCheckTime = new Map<string, number>();
const DEBOUNCE_MS = 60_000;

/** Test-only: reset the debounce cache so tests start with clean state. */
export function _resetDebounceCache(): void {
  lastCheckTime.clear();
}

function isDebounced(filePath: string): boolean {
  const last = lastCheckTime.get(filePath);
  if (!last) return false;
  return Date.now() - last < DEBOUNCE_MS;
}

function markChecked(filePath: string): void {
  lastCheckTime.set(filePath, Date.now());
}

// ─── Project Discovery ──────────────────────────────────────────────────────

/** Max directory levels to traverse upward when searching for project root. */
const MAX_DIR_DEPTH = 50;

/**
 * Walk up from file path to find the project root and type-check command.
 *
 * Discovery order:
 * 1. package.json with "check" script (covers svelte-check, astro check, etc.)
 * 2. package.json with "typecheck" script
 * 3. tsconfig.json exists → tsc --noEmit
 */
export function discoverTypeCheck(
  filePath: string,
  deps: Pick<TypeCheckVerifierDeps, "fileExists" | "readFile">,
): TypeCheckCommand | null {
  let dir = dirname(filePath);
  const root = "/";

  for (let depth = 0; depth < MAX_DIR_DEPTH; depth++) {
    if (dir === root) break;

    const pkgPath = join(dir, "package.json");
    if (deps.fileExists(pkgPath)) {
      const content = deps.readFile(pkgPath);
      if (content) {
        const scripts = extractScripts(content);

        // Prefer "check" script (project-specific, covers svelte-check etc.)
        if (scripts.check) {
          return parseCheckScript(scripts.check, dir);
        }

        // Fall back to "typecheck" script
        if (scripts.typecheck) {
          return parseCheckScript(scripts.typecheck, dir);
        }
      }

      // package.json exists but no check scripts — try tsconfig in same dir
      const tsconfigPath = join(dir, "tsconfig.json");
      if (deps.fileExists(tsconfigPath)) {
        return { cmd: "npx", args: ["tsc", "--noEmit"], cwd: dir };
      }

      // Found package.json but no type checking available — stop walking
      return null;
    }

    // No package.json — check for tsconfig.json standalone
    const tsconfigPath = join(dir, "tsconfig.json");
    if (deps.fileExists(tsconfigPath)) {
      return { cmd: "npx", args: ["tsc", "--noEmit"], cwd: dir };
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

function extractScripts(packageJsonContent: string): Record<string, string> {
  const match = packageJsonContent.match(/"scripts"\s*:\s*\{([^}]*)\}/);
  if (!match) return {};

  const scripts: Record<string, string> = {};
  const entries = match[1].matchAll(/"(\w+)"\s*:\s*"([^"]*)"/g);
  for (const entry of entries) {
    scripts[entry[1]] = entry[2];
  }
  return scripts;
}

function parseCheckScript(script: string, cwd: string): TypeCheckCommand {
  // Handle common patterns:
  // "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json"
  // "tsc --noEmit"
  // "vue-tsc --noEmit"
  const parts = script.split("&&").map((s) => s.trim());
  // Use the last command (the actual check, after any sync/prep steps)
  const checkCmd = parts[parts.length - 1];
  const tokens = checkCmd.split(/\s+/);
  const cmd = "npx";
  const args = tokens;

  return { cmd, args, cwd };
}

// ─── Output Parsing ─────────────────────────────────────────────────────────

/**
 * Parse type-check output to extract errors for a specific file.
 *
 * Handles two formats:
 * - tsc:          file.ts(line,col): error TS1234: message
 * - svelte-check: TIMESTAMP ERROR "file.svelte" line:col "message"
 */
export function parseTypeErrors(output: string, targetFile: string): TypeCheckError[] {
  const errors: TypeCheckError[] = [];
  const normalizedTarget = normalizePath(targetFile);

  for (const line of output.split("\n")) {
    // tsc format: path(line,col): error TS1234: message
    const tscMatch = line.match(/^(.+?)\((\d+),(\d+)\):\s*error\s+TS\d+:\s*(.+)$/);
    if (tscMatch) {
      if (normalizePath(tscMatch[1]) === normalizedTarget) {
        errors.push({
          file: tscMatch[1],
          line: parseInt(tscMatch[2], 10),
          col: parseInt(tscMatch[3], 10),
          message: tscMatch[4].trim(),
        });
      }
      continue;
    }

    // svelte-check format: TIMESTAMP ERROR "file" line:col "message"
    const svelteMatch = line.match(/^\d+\s+ERROR\s+"([^"]+)"\s+(\d+):(\d+)\s+"(.+)"$/);
    if (svelteMatch) {
      if (normalizePath(svelteMatch[1]) === normalizedTarget) {
        errors.push({
          file: svelteMatch[1],
          line: parseInt(svelteMatch[2], 10),
          col: parseInt(svelteMatch[3], 10),
          message: svelteMatch[4].replace(/\\n/g, " ").trim(),
        });
      }
    }
  }

  return errors;
}

function normalizePath(p: string): string {
  // Strip leading ./ and resolve to compare paths
  return p.replace(/^\.\//, "").replace(/\/+/g, "/");
}

// ─── Advisory Formatting ────────────────────────────────────────────────────

function formatAdvisory(errors: TypeCheckError[], filePath: string): string {
  const lines = errors.map((e) => `  Line ${e.line}:${e.col}: ${e.message}`);

  return [
    `⚠️ TYPE ERRORS — ${errors.length} type error${errors.length === 1 ? "" : "s"} in ${filePath}:`,
    "",
    ...lines,
    "",
    "These errors come from the project's type checker. Fix them to ensure type safety.",
    "Read the relevant type definitions before applying fixes — the correct type likely exists.",
  ].join("\n");
}

// ─── Contract ────────────────────────────────────────────────────────────────

function isTypeCheckableFile(filePath: string): boolean {
  return /\.tsx?$/.test(filePath) || isSvelteFile(filePath);
}

const defaultDeps: TypeCheckVerifierDeps = {
  fileExists,
  readFile: (path: string): string | null => {
    const result = readFile(path);
    return result.ok ? result.value : null;
  },
  execWithTimeout: (cmd: string, args: string[], cwd: string, timeoutMs: number): ExecResult => {
    const result = spawnSyncSafe(cmd, args, {
      cwd,
      timeout: timeoutMs,
      encoding: "utf-8",
      stdio: "pipe",
    });
    if (!result.ok) {
      return { stdout: "", stderr: "", exitCode: 1, timedOut: false };
    }
    return {
      stdout: result.value.stdout,
      stderr: "",
      exitCode: result.value.exitCode,
      timedOut: result.value.exitCode === -1,
    };
  },
  signal: defaultSignalLoggerDeps,
  stderr: defaultStderr,
};

export const TypeCheckVerifier: SyncHookContract<
  ToolHookInput,
  ContinueOutput,
  TypeCheckVerifierDeps
> = {
  name: "TypeCheckVerifier",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    if (input.tool_name !== "Edit" && input.tool_name !== "Write") return false;
    const filePath = getFilePath(input);
    if (!filePath) return false;
    if (!isTypeCheckableFile(filePath)) return false;
    if (isDebounced(filePath)) return false;
    return true;
  },

  execute(input: ToolHookInput, deps: TypeCheckVerifierDeps): Result<ContinueOutput, PaiError> {
    const filePath = getFilePath(input)!;

    // Discover project type-check command
    const typeCheck = discoverTypeCheck(filePath, deps);
    if (!typeCheck) {
      deps.stderr(`[TypeCheckVerifier] ${filePath}: no type checker found, skipping`);
      return ok(continueOk());
    }

    deps.stderr(
      `[TypeCheckVerifier] Running: ${typeCheck.cmd} ${typeCheck.args.join(" ")} in ${typeCheck.cwd}`,
    );

    // Run type checker with timeout
    const result = deps.execWithTimeout(typeCheck.cmd, typeCheck.args, typeCheck.cwd, 10_000);

    // Mark as checked regardless of outcome (debounce)
    markChecked(filePath);

    if (result.timedOut) {
      deps.stderr(`[TypeCheckVerifier] ${filePath}: type check timed out after 10s`);
      logSignal(deps.signal, "type-check-verifier.jsonl", {
        session_id: input.session_id,
        hook: "TypeCheckVerifier",
        event: "PostToolUse",
        tool: input.tool_name,
        file: filePath,
        outcome: "timeout",
      });
      return ok(continueOk());
    }

    // Parse output for errors in the edited file
    const combinedOutput = `${result.stdout}\n${result.stderr}`;
    const errors = parseTypeErrors(combinedOutput, filePath);

    logSignal(deps.signal, "type-check-verifier.jsonl", {
      session_id: input.session_id,
      hook: "TypeCheckVerifier",
      event: "PostToolUse",
      tool: input.tool_name,
      file: filePath,
      outcome: errors.length > 0 ? "errors" : "clean",
      error_count: errors.length,
    });

    if (errors.length === 0) {
      deps.stderr(`[TypeCheckVerifier] ${filePath}: no type errors`);
      return ok(continueOk());
    }

    deps.stderr(`[TypeCheckVerifier] ${filePath}: ${errors.length} type error(s)`);
    const advisory = formatAdvisory(errors, filePath);

    return ok(continueOk(advisory));
  },

  defaultDeps,
};
