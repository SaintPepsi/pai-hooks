/**
 * SecurityValidator Contract — Security validation for tool calls.
 *
 * Validates Bash commands and file operations against YAML security
 * patterns. Returns continue/ask/block decisions. Hard blocks exit
 * with code 2 (handled by the runner's format layer).
 */

import type { HookContract } from "@hooks/core/contract";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput, BlockOutput } from "@hooks/core/types/hook-outputs";
import { ok, err, type Result } from "@hooks/core/result";
import { type PaiError, securityBlock as securityBlockError } from "@hooks/core/error";
import { fileExists, readFile, writeFile, ensureDir } from "@hooks/core/adapters/fs";
import { safeRegexTest, createRegex } from "@hooks/core/adapters/regex";
import { safeParseYaml } from "@hooks/core/adapters/yaml";
import { pickNarrative } from "@hooks/lib/narrative-reader";
import { join } from "path";
import { homedir } from "os";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Pattern {
  pattern: string;
  reason: string;
}

interface PatternsConfig {
  version: string;
  philosophy: { mode: string; principle: string };
  bash: { blocked: Pattern[]; confirm: Pattern[]; alert: Pattern[] };
  paths: { zeroAccess: string[]; readOnly: string[]; confirmWrite: string[]; noDelete: string[] };
  projects: Record<string, { path: string; rules: Array<{ action: string; reason: string }> }>;
}

interface SecurityEvent {
  timestamp: string;
  session_id: string;
  event_type: "block" | "confirm" | "alert" | "allow";
  tool: string;
  category: "bash_command" | "path_access";
  target: string;
  pattern_matched?: string;
  reason?: string;
  action_taken: string;
}

type PathAction = "read" | "write" | "delete";
type ValidationResult = { action: "allow" | "block" | "confirm" | "alert"; reason?: string };

export interface SecurityValidatorDeps {
  fileExists: (path: string) => boolean;
  readFile: (path: string) => Result<string, PaiError>;
  writeFile: (path: string, content: string) => Result<void, PaiError>;
  ensureDir: (path: string) => Result<void, PaiError>;
  safeParseYaml: (content: string) => unknown | null;
  safeRegexTest: (input: string, pattern: string, flags?: string) => boolean;
  createRegex: (pattern: string, flags?: string) => RegExp | null;
  homedir: () => string;
  baseDir: string;
  stderr: (msg: string) => void;
}

// ─── Pure Logic ──────────────────────────────────────────────────────────────

const EMPTY_PATTERNS: PatternsConfig = {
  version: "0.0",
  philosophy: { mode: "permissive", principle: "No patterns loaded - fail open" },
  bash: { blocked: [], confirm: [], alert: [] },
  paths: { zeroAccess: [], readOnly: [], confirmWrite: [], noDelete: [] },
  projects: {},
};

export function stripEnvVarPrefix(command: string): string {
  return command.replace(
    /^\s*(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]*)\s+)*/,
    "",
  );
}

export function matchesPattern(command: string, pattern: string, deps: SecurityValidatorDeps): boolean {
  if (deps.safeRegexTest(command, pattern, "i")) return true;
  return command.toLowerCase().includes(pattern.toLowerCase());
}

export function matchesPathPattern(filePath: string, pattern: string, home: string, deps: SecurityValidatorDeps): boolean {
  const expandPath = (p: string) => (p.startsWith("~") ? p.replace("~", home) : p);
  const expandedPattern = expandPath(pattern);
  const expandedPath = expandPath(filePath);

  if (pattern.includes("*")) {
    const regexPattern = expandedPattern
      .replace(/\*\*/g, "<<<DOUBLESTAR>>>")
      .replace(/\*/g, "<<<SINGLESTAR>>>")
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/<<<DOUBLESTAR>>>/g, ".*")
      .replace(/<<<SINGLESTAR>>>/g, "[^/]*");

    const regex = deps.createRegex(`^${regexPattern}$`);
    if (regex) return regex.test(expandedPath);
    return false;
  }

  return expandedPath === expandedPattern ||
    expandedPath.startsWith(expandedPattern.endsWith("/") ? expandedPattern : expandedPattern + "/");
}

function loadPatterns(deps: SecurityValidatorDeps): PatternsConfig {
  const userPath = join(deps.baseDir, "PAI", "USER", "PAISECURITYSYSTEM", "patterns.yaml");
  const systemPath = join(deps.baseDir, "PAI", "PAISECURITYSYSTEM", "patterns.example.yaml");

  const patternsPath = deps.fileExists(userPath) ? userPath : deps.fileExists(systemPath) ? systemPath : null;
  if (!patternsPath) return EMPTY_PATTERNS;

  const result = deps.readFile(patternsPath);
  if (!result.ok) return EMPTY_PATTERNS;

  const parsed = deps.safeParseYaml(result.value);
  if (!parsed) return EMPTY_PATTERNS;
  return parsed as PatternsConfig;
}

function validateBashCommand(command: string, patterns: PatternsConfig, deps: SecurityValidatorDeps): ValidationResult {
  for (const p of patterns.bash.blocked) {
    if (matchesPattern(command, p.pattern, deps)) return { action: "block", reason: p.reason };
  }
  for (const p of patterns.bash.confirm) {
    if (matchesPattern(command, p.pattern, deps)) return { action: "confirm", reason: p.reason };
  }
  for (const p of patterns.bash.alert) {
    if (matchesPattern(command, p.pattern, deps)) return { action: "alert", reason: p.reason };
  }
  return { action: "allow" };
}

function validatePath(filePath: string, action: PathAction, patterns: PatternsConfig, home: string, deps: SecurityValidatorDeps): ValidationResult {
  for (const p of patterns.paths.zeroAccess) {
    if (matchesPathPattern(filePath, p, home, deps)) return { action: "block", reason: `Zero access path: ${p}` };
  }

  if (action === "write" || action === "delete") {
    for (const p of patterns.paths.readOnly) {
      if (matchesPathPattern(filePath, p, home, deps)) return { action: "block", reason: `Read-only path: ${p}` };
    }
  }

  if (action === "write") {
    for (const p of patterns.paths.confirmWrite) {
      if (matchesPathPattern(filePath, p, home, deps)) return { action: "confirm", reason: `Writing to protected file requires confirmation: ${p}` };
    }
  }

  if (action === "delete") {
    for (const p of patterns.paths.noDelete) {
      if (matchesPathPattern(filePath, p, home, deps)) return { action: "block", reason: `Cannot delete protected path: ${p}` };
    }
  }

  return { action: "allow" };
}

function countViolations(result: ValidationResult): number {
  if (result.action === "block") return 3;
  if (result.action === "confirm") return 2;
  if (result.action === "alert") return 1;
  return 0;
}

function logSecurityEvent(event: SecurityEvent, deps: SecurityValidatorDeps): void {
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  const hour = now.getHours().toString().padStart(2, "0");
  const min = now.getMinutes().toString().padStart(2, "0");
  const sec = now.getSeconds().toString().padStart(2, "0");

  const summary = [
    event.event_type,
    ...(event.reason || event.target || "unknown")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .slice(0, 5),
  ].join("-");

  const logPath = join(
    deps.baseDir, "MEMORY", "SECURITY", year, month,
    `security-${summary}-${year}${month}${day}-${hour}${min}${sec}.jsonl`,
  );
  const dir = logPath.substring(0, logPath.lastIndexOf("/"));
  deps.ensureDir(dir);

  deps.writeFile(logPath, JSON.stringify(event, null, 2));
}

// ─── Contract ────────────────────────────────────────────────────────────────

const BASE_DIR = process.env.PAI_DIR || join(process.env.HOME!, ".claude");

const defaultDeps: SecurityValidatorDeps = {
  fileExists,
  readFile,
  writeFile,
  ensureDir,
  safeParseYaml,
  safeRegexTest,
  createRegex,
  homedir,
  baseDir: BASE_DIR,
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const SecurityValidator: HookContract<
  ToolHookInput,
  ContinueOutput | AskOutput | BlockOutput,
  SecurityValidatorDeps
> = {
  name: "SecurityValidator",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    return ["Bash", "Edit", "MultiEdit", "Write", "Read"].includes(input.tool_name);
  },

  execute(
    input: ToolHookInput,
    deps: SecurityValidatorDeps,
  ): Result<ContinueOutput | AskOutput | BlockOutput, PaiError> {
    const { tool_name, session_id } = input;
    const patterns = loadPatterns(deps);
    const home = deps.homedir();

    // Bash command validation
    if (tool_name === "Bash") {
      const rawCommand = typeof input.tool_input === "string"
        ? input.tool_input
        : (input.tool_input?.command as string) || "";

      if (!rawCommand) return ok({ type: "continue", continue: true });

      const command = stripEnvVarPrefix(rawCommand);
      const result = validateBashCommand(command, patterns, deps);

      if (result.action === "block") {
        const opener = pickNarrative("SecurityValidator", countViolations(result));
        logSecurityEvent({
          timestamp: new Date().toISOString(),
          session_id,
          event_type: "block",
          tool: "Bash",
          category: "bash_command",
          target: command.slice(0, 500),
          reason: result.reason,
          action_taken: "Hard block",
        }, deps);
        deps.stderr(`[PAI SECURITY] ${opener}`);
        return err(securityBlockError(result.reason || "Blocked by security policy"));
      }

      if (result.action === "confirm") {
        const opener = pickNarrative("SecurityValidator", countViolations(result));
        logSecurityEvent({
          timestamp: new Date().toISOString(),
          session_id,
          event_type: "confirm",
          tool: "Bash",
          category: "bash_command",
          target: command.slice(0, 500),
          reason: result.reason,
          action_taken: "Blocked (confirm category)",
        }, deps);
        deps.stderr(`[PAI SECURITY] ${opener}`);
        return err(securityBlockError(
          `${result.reason}\n\nCommand: ${command.slice(0, 200)}\n\nThis operation requires confirmation. Run it manually outside Claude Code.`,
        ));
      }

      if (result.action === "alert") {
        logSecurityEvent({
          timestamp: new Date().toISOString(),
          session_id,
          event_type: "alert",
          tool: "Bash",
          category: "bash_command",
          target: command.slice(0, 500),
          reason: result.reason,
          action_taken: "Logged alert, allowed",
        }, deps);
        deps.stderr(`[PAI SECURITY] ALERT: ${result.reason}`);
      }

      return ok({ type: "continue", continue: true });
    }

    // File path validation (Edit, MultiEdit, Write, Read)
    const filePath = typeof input.tool_input === "string"
      ? input.tool_input
      : (input.tool_input?.file_path as string) || "";

    if (!filePath) return ok({ type: "continue", continue: true });

    const action: PathAction = tool_name === "Read" ? "read" : "write";
    const result = validatePath(filePath, action, patterns, home, deps);

    if (result.action === "block") {
      const opener = pickNarrative("SecurityValidator", countViolations(result));
      logSecurityEvent({
        timestamp: new Date().toISOString(),
        session_id,
        event_type: "block",
        tool: tool_name,
        category: "path_access",
        target: filePath,
        reason: result.reason,
        action_taken: "Hard block",
      }, deps);
      deps.stderr(`[PAI SECURITY] ${opener}`);
      return err(securityBlockError(result.reason || "Blocked by security policy"));
    }

    if (result.action === "confirm") {
      const opener = pickNarrative("SecurityValidator", countViolations(result));
      logSecurityEvent({
        timestamp: new Date().toISOString(),
        session_id,
        event_type: "confirm",
        tool: tool_name,
        category: "path_access",
        target: filePath,
        reason: result.reason,
        action_taken: "Blocked (confirm category)",
      }, deps);
      deps.stderr(`[PAI SECURITY] ${opener}`);
      return err(securityBlockError(
        `${result.reason}\n\nPath: ${filePath}\n\nThis operation requires confirmation. Run it manually outside Claude Code.`,
      ));
    }

    return ok({ type: "continue", continue: true });
  },

  defaultDeps,
};
