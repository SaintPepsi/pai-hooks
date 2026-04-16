/**
 * SecurityValidator Contract — Security validation for tool calls.
 *
 * Validates Bash commands and file operations against YAML security
 * patterns. Returns continue/ask/block decisions. Hard blocks exit
 * with code 2 (handled by the runner's format layer).
 */

import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { ensureDir, fileExists, readFile, writeFile } from "@hooks/core/adapters/fs";
import { createRegex, safeRegexTest } from "@hooks/core/adapters/regex";
import type { SyncHookContract } from "@hooks/core/contract";
import { type ResultError, securityBlock as securityBlockError } from "@hooks/core/error";
import { err, ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { PatternsConfig } from "@hooks/hooks/SecurityValidator/patterns-schema";
import { decodePatternsConfig } from "@hooks/hooks/SecurityValidator/patterns-schema";
import { pickNarrative } from "@hooks/lib/narrative-reader";
import { defaultStderr, getHomeDir, getPaiDir } from "@hooks/lib/paths";

// ─── Types ───────────────────────────────────────────────────────────────────

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
type ValidationResult = {
  action: "allow" | "block" | "confirm" | "alert";
  reason?: string;
};

export interface SecurityValidatorDeps {
  fileExists: (path: string) => boolean;
  readFile: (path: string) => Result<string, ResultError>;
  writeFile: (path: string, content: string) => Result<void, ResultError>;
  ensureDir: (path: string) => Result<void, ResultError>;
  safeRegexTest: (input: string, pattern: string, flags?: string) => boolean;
  createRegex: (pattern: string, flags?: string) => RegExp | null;
  homedir: () => string;
  baseDir: string;
  stderr: (msg: string) => void;
}

// ─── Pure Logic ──────────────────────────────────────────────────────────────

const EMPTY_PATTERNS: PatternsConfig = {
  version: "0.0",
  philosophy: {
    mode: "permissive",
    principle: "No patterns loaded - fail open",
  },
  bash: { blocked: [], confirm: [], alert: [] },
  paths: { zeroAccess: [], readOnly: [], confirmWrite: [], noDelete: [] },
  projects: {},
};

export function stripEnvVarPrefix(command: string): string {
  return command.replace(/^\s*(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]*)\s+)*/, "");
}

/**
 * Splits a command string on top-level chain operators (&&, ||, ;)
 * without splitting inside quoted strings.
 */
function splitChainedCommands(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    const next = command[i + 1];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (inSingle || inDouble) {
      current += ch;
      continue;
    }

    if (ch === ";" || (ch === "&" && next === "&") || (ch === "|" && next === "|")) {
      parts.push(current.trim());
      current = "";
      if (ch !== ";") i++; // skip second char of && or ||
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * Extracts file paths that a bash command would write to.
 *
 * Detects: sed -i, perl -i, awk -i inplace, shell redirects (>, >>),
 * tee, cp, mv, dd of=. Returns empty array for non-file-modifying commands.
 */
export function extractWriteTargets(command: string): string[] {
  const targets: string[] = [];
  const subCommands = splitChainedCommands(command);

  for (const sub of subCommands) {
    const stripped = sub.trim();

    // sed -i / sed --in-place — target is last non-option argument
    if (/\bsed\b/.test(stripped) && (/\s-i\b/.test(stripped) || /--in-place\b/.test(stripped))) {
      // Remove the sed command, flags, backup suffix, and script expression to find file args
      // Pattern: sed [-i[suffix] | --in-place[=suffix]] [other flags] 'script' file...
      const args = stripped.split(/\s+/);
      // Last argument that looks like a path (not a flag, not a sed script)
      for (let i = args.length - 1; i >= 1; i--) {
        const arg = args[i];
        if (arg.startsWith("-") || arg.startsWith("'") || arg.startsWith('"')) continue;
        if (arg.includes("/") || arg.includes(".")) {
          targets.push(arg);
          break;
        }
      }
      continue;
    }

    // perl -i / perl -pi -e — target is last argument
    if (/\bperl\b/.test(stripped) && /\s-\w*i/.test(stripped)) {
      const args = stripped.split(/\s+/);
      const lastArg = args[args.length - 1];
      if (
        lastArg &&
        !lastArg.startsWith("-") &&
        !lastArg.startsWith("'") &&
        !lastArg.startsWith('"')
      ) {
        targets.push(lastArg);
      }
      continue;
    }

    // awk -i inplace — target is last argument
    if (/\bawk\b/.test(stripped) && /\s-i\s+inplace\b/.test(stripped)) {
      const args = stripped.split(/\s+/);
      const lastArg = args[args.length - 1];
      if (lastArg && !lastArg.startsWith("-") && !lastArg.startsWith("'")) {
        targets.push(lastArg);
      }
      continue;
    }

    // dd of=path
    const ddMatch = stripped.match(/\bdd\b.*\bof=(\S+)/);
    if (ddMatch) {
      targets.push(ddMatch[1]);
      continue;
    }

    // tee [-a] path — extract file argument after tee
    const teeMatch = stripped.match(/\btee\s+(?:-a\s+)?(\S+)\s*$/);
    if (teeMatch) {
      targets.push(teeMatch[1]);
      continue;
    }

    // cp / mv / install — destination is last argument
    if (/^(?:cp|mv|install)\s/.test(stripped)) {
      const args = stripped.split(/\s+/).filter((a) => !a.startsWith("-"));
      // args[0] is the command, last is destination
      if (args.length >= 3) {
        targets.push(args[args.length - 1]);
      }
      continue;
    }

    // Shell redirects: > file or >> file
    const redirectMatch = stripped.match(/>{1,2}\s*(\S+)\s*$/);
    if (redirectMatch) {
      targets.push(redirectMatch[1]);
      continue;
    }

    // Inline script execution (bun -e, node -e, deno eval, python -c, python3 -c)
    // These can write to files programmatically, bypassing shell-level write detection.
    // Extract any file paths mentioned in the inline script body.
    const inlineScriptMatch = stripped.match(
      /\b(?:bun|node|deno)\s+(?:-e|eval)\s+["'](.+)["']|(?:python3?)\s+-c\s+["'](.+)["']/s,
    );
    if (inlineScriptMatch) {
      const scriptBody = inlineScriptMatch[1] || inlineScriptMatch[2] || "";
      // Look for file write patterns and extract the path argument
      const writePatterns = [
        /writeFileSync\s*\(\s*["']([^"']+)["']/g,
        /writeFile\s*\(\s*["']([^"']+)["']/g,
        /open\s*\(\s*["']([^"']+)["']\s*,\s*["'][wa]/g,
        /\.write\s*\(\s*["']([^"']+)["']/g,
      ];
      for (const pattern of writePatterns) {
        let match;
        while ((match = pattern.exec(scriptBody)) !== null) {
          targets.push(match[1]);
        }
      }
    }
  }

  return targets;
}

export function matchesPattern(
  command: string,
  pattern: string,
  deps: SecurityValidatorDeps,
): boolean {
  if (deps.safeRegexTest(command, pattern, "i")) return true;
  return command.toLowerCase().includes(pattern.toLowerCase());
}

export function matchesPathPattern(
  filePath: string,
  pattern: string,
  home: string,
  deps: SecurityValidatorDeps,
): boolean {
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

  return (
    expandedPath === expandedPattern ||
    expandedPath.startsWith(expandedPattern.endsWith("/") ? expandedPattern : `${expandedPattern}/`)
  );
}

function loadPatterns(deps: SecurityValidatorDeps): PatternsConfig {
  const patternsPath = join(import.meta.dir, "..", "patterns.json");
  const result = deps.readFile(patternsPath);
  if (!result.ok) {
    deps.stderr(
      `[SecurityValidator] WARNING: Failed to read ${patternsPath} — all validation bypassed`,
    );
    return EMPTY_PATTERNS;
  }

  const config = decodePatternsConfig(result.value);
  if (!config) {
    deps.stderr(
      `[SecurityValidator] WARNING: Failed to parse ${patternsPath} — all validation bypassed`,
    );
    return EMPTY_PATTERNS;
  }
  return config;
}

function validateBashCommand(
  command: string,
  patterns: PatternsConfig,
  deps: SecurityValidatorDeps,
): ValidationResult {
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

function validatePath(
  filePath: string,
  action: PathAction,
  patterns: PatternsConfig,
  home: string,
  deps: SecurityValidatorDeps,
): ValidationResult {
  for (const p of patterns.paths.zeroAccess) {
    if (matchesPathPattern(filePath, p, home, deps))
      return { action: "block", reason: `Zero access path: ${p}` };
  }

  if (action === "write" || action === "delete") {
    for (const p of patterns.paths.readOnly) {
      if (matchesPathPattern(filePath, p, home, deps))
        return { action: "block", reason: `Read-only path: ${p}` };
    }
  }

  if (action === "write") {
    for (const p of patterns.paths.confirmWrite) {
      if (matchesPathPattern(filePath, p, home, deps))
        return {
          action: "confirm",
          reason: `Writing to protected file requires confirmation: ${p}`,
        };
    }
  }

  if (action === "delete") {
    for (const p of patterns.paths.noDelete) {
      if (matchesPathPattern(filePath, p, home, deps))
        return {
          action: "block",
          reason: `Cannot delete protected path: ${p}`,
        };
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
    deps.baseDir,
    "MEMORY",
    "SECURITY",
    year,
    month,
    `security-${summary}-${year}${month}${day}-${hour}${min}${sec}.jsonl`,
  );
  const dir = logPath.substring(0, logPath.lastIndexOf("/"));
  deps.ensureDir(dir);

  deps.writeFile(logPath, JSON.stringify(event, null, 2));
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: SecurityValidatorDeps = {
  fileExists,
  readFile,
  writeFile,
  ensureDir,
  safeRegexTest,
  createRegex,
  homedir: getHomeDir,
  baseDir: getPaiDir(),
  stderr: defaultStderr,
};

export const SecurityValidator: SyncHookContract<ToolHookInput, SecurityValidatorDeps> = {
  name: "SecurityValidator",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    return ["Bash", "Edit", "MultiEdit", "Write", "Read"].includes(input.tool_name);
  },

  execute(
    input: ToolHookInput,
    deps: SecurityValidatorDeps,
  ): Result<SyncHookJSONOutput, ResultError> {
    const { tool_name, session_id } = input;
    const patterns = loadPatterns(deps);
    const home = deps.homedir();

    // Bash command validation
    if (tool_name === "Bash") {
      const rawCommand =
        typeof input.tool_input === "string"
          ? input.tool_input
          : (input.tool_input?.command as string) || "";

      if (!rawCommand) return ok({ continue: true });

      const command = stripEnvVarPrefix(rawCommand);
      const result = validateBashCommand(command, patterns, deps);

      if (result.action === "block") {
        const opener = pickNarrative("SecurityValidator", countViolations(result), import.meta.dir);
        logSecurityEvent(
          {
            timestamp: new Date().toISOString(),
            session_id,
            event_type: "block",
            tool: "Bash",
            category: "bash_command",
            target: command.slice(0, 500),
            reason: result.reason,
            action_taken: "Hard block",
          },
          deps,
        );
        deps.stderr(`[PAI SECURITY] ${opener}`);
        return err(securityBlockError(result.reason || "Blocked by security policy"));
      }

      if (result.action === "confirm") {
        const opener = pickNarrative("SecurityValidator", countViolations(result), import.meta.dir);
        logSecurityEvent(
          {
            timestamp: new Date().toISOString(),
            session_id,
            event_type: "confirm",
            tool: "Bash",
            category: "bash_command",
            target: command.slice(0, 500),
            reason: result.reason,
            action_taken: "Blocked (confirm category)",
          },
          deps,
        );
        deps.stderr(`[PAI SECURITY] ${opener}`);
        return err(
          securityBlockError(
            `${result.reason}\n\nCommand: ${command.slice(0, 200)}\n\nThis operation requires confirmation. Run it manually outside Claude Code.`,
          ),
        );
      }

      if (result.action === "alert") {
        logSecurityEvent(
          {
            timestamp: new Date().toISOString(),
            session_id,
            event_type: "alert",
            tool: "Bash",
            category: "bash_command",
            target: command.slice(0, 500),
            reason: result.reason,
            action_taken: "Logged alert, allowed",
          },
          deps,
        );
        deps.stderr(`[PAI SECURITY] ALERT: ${result.reason}`);
      }

      // Tool substitution bypass prevention: extract file paths from
      // file-modifying bash commands and validate them against path patterns.
      // Closes the gap where Edit/Write is blocked but sed/cp/mv/tee via Bash is not.
      const writeTargets = extractWriteTargets(command);
      for (const target of writeTargets) {
        const pathResult = validatePath(target, "write", patterns, home, deps);
        if (pathResult.action === "block" || pathResult.action === "confirm") {
          const opener = pickNarrative(
            "SecurityValidator",
            countViolations(pathResult),
            import.meta.dir,
          );
          logSecurityEvent(
            {
              timestamp: new Date().toISOString(),
              session_id,
              event_type: pathResult.action === "block" ? "block" : "confirm",
              tool: "Bash",
              category: "path_access",
              target,
              pattern_matched: command.slice(0, 200),
              reason: `Tool substitution bypass: ${pathResult.reason}`,
              action_taken: "Blocked (bash file modification to protected path)",
            },
            deps,
          );
          deps.stderr(`[PAI SECURITY] ${opener}`);
          return err(
            securityBlockError(
              `${pathResult.reason}\n\nBash command modifies protected path via tool substitution: ${target}\nCommand: ${command.slice(0, 200)}\n\nUse Edit/Write tools instead, or run manually outside Claude Code.`,
            ),
          );
        }
      }

      return ok({ continue: true });
    }

    // File path validation (Edit, MultiEdit, Write, Read)
    const filePath =
      typeof input.tool_input === "string"
        ? input.tool_input
        : (input.tool_input?.file_path as string) || "";

    if (!filePath) return ok({ continue: true });

    const action: PathAction = tool_name === "Read" ? "read" : "write";
    const result = validatePath(filePath, action, patterns, home, deps);

    if (result.action === "block") {
      const opener = pickNarrative("SecurityValidator", countViolations(result), import.meta.dir);
      logSecurityEvent(
        {
          timestamp: new Date().toISOString(),
          session_id,
          event_type: "block",
          tool: tool_name,
          category: "path_access",
          target: filePath,
          reason: result.reason,
          action_taken: "Hard block",
        },
        deps,
      );
      deps.stderr(`[PAI SECURITY] ${opener}`);
      return err(securityBlockError(result.reason || "Blocked by security policy"));
    }

    if (result.action === "confirm") {
      const opener = pickNarrative("SecurityValidator", countViolations(result), import.meta.dir);
      logSecurityEvent(
        {
          timestamp: new Date().toISOString(),
          session_id,
          event_type: "confirm",
          tool: tool_name,
          category: "path_access",
          target: filePath,
          reason: result.reason,
          action_taken: "Blocked (confirm category)",
        },
        deps,
      );
      deps.stderr(`[PAI SECURITY] ${opener}`);
      return err(
        securityBlockError(
          `${result.reason}\n\nPath: ${filePath}\n\nThis operation requires confirmation. Run it manually outside Claude Code.`,
        ),
      );
    }

    return ok({ continue: true });
  },

  defaultDeps,
};
