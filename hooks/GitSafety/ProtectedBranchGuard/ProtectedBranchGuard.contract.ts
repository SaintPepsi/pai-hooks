/**
 * ProtectedBranchGuard Contract — Block git mutations on main/master.
 *
 * PreToolUse hook that fires on Bash commands. Detects git commit, push,
 * and merge commands, checks the current branch, and blocks if on a
 * protected branch (main/master).
 *
 * Exempts configurable directories from protection. Configure in
 * ~/.claude/settings.json under hookConfig.protectedBranchGuard.exemptDirs.
 * Fails open if branch cannot be determined.
 *
 * Pattern: pai-hooks/contracts/BashWriteGuard.ts
 */

import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { readFile } from "@hooks/core/adapters/fs";
import { execSyncSafe } from "@hooks/core/adapters/process";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { readHookConfig } from "@hooks/lib/hook-config";
import { defaultStderr } from "@hooks/lib/paths";
import { getCommand } from "@hooks/lib/tool-input";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProtectedBranchGuardDeps {
  getBranch: () => string | null;
  getCwd: () => string;
  getExemptDirs: () => string[];
  stderr: (msg: string) => void;
}

interface ProtectedBranchGuardConfig {
  exemptDirs: string[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PROTECTED_BRANCHES = ["main", "master"];

const DEFAULT_CONFIG: ProtectedBranchGuardConfig = {
  exemptDirs: [],
};

/** Load config: defaults from config.json, overrides from hookConfig.protectedBranchGuard */
function loadConfig(): ProtectedBranchGuardConfig {
  const config = { ...DEFAULT_CONFIG };

  // Load defaults from config.json next to this file
  const configPath = join(__dirname, "config.json");
  const localConfig = readFile(configPath);
  if (localConfig.ok) {
    try {
      const parsed = JSON.parse(localConfig.value) as Partial<ProtectedBranchGuardConfig>;
      if (Array.isArray(parsed.exemptDirs)) config.exemptDirs = parsed.exemptDirs;
    } catch {
      // Ignore parse errors, use defaults
    }
  }

  // Override with hookConfig.protectedBranchGuard from settings.json
  const hookConfig = readHookConfig<Partial<ProtectedBranchGuardConfig>>("protectedBranchGuard");
  if (hookConfig) {
    if (Array.isArray(hookConfig.exemptDirs)) config.exemptDirs = hookConfig.exemptDirs;
  }

  return config;
}

/**
 * Built-in exempt directories. These are always exempt regardless of settings.
 * ~/.claude is exempt because GitAutoSync legitimately commits there.
 */
const BUILTIN_EXEMPT_PATTERNS: RegExp[] = [/\/\.claude(?:\/|$)/];

// Matches git commit, git push, git merge (the mutation commands)
// Ref: https://git-scm.com/docs — these are the commands that modify history
const GIT_MUTATION_PATTERN = /\bgit\s+(commit|push|merge)\b/;

// ─── Pure Functions ─────────────────────────────────────────────────────────

/** Check if command contains a git mutation (commit/push/merge). */
function isGitMutation(command: string): boolean {
  return GIT_MUTATION_PATTERN.test(command);
}

/** Build regex patterns from user-configured directory names. */
function buildExemptPatterns(dirs: string[]): RegExp[] {
  return dirs.map((dir) => {
    const escaped = dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\/${escaped}(?:\\/|$)`);
  });
}

/** Check if CWD is inside an exempt directory. */
function isExemptDir(cwd: string, extraDirs: string[]): boolean {
  const userPatterns = buildExemptPatterns(extraDirs);
  const allPatterns = [...BUILTIN_EXEMPT_PATTERNS, ...userPatterns];
  return allPatterns.some((p) => p.test(cwd));
}

// ─── Default Deps ───────────────────────────────────────────────────────────

const defaultDeps: ProtectedBranchGuardDeps = {
  getBranch: () => {
    const result = execSyncSafe("git branch --show-current");
    if (!result.ok) return null;
    return result.value.trim() || null;
  },
  getCwd: () => process.cwd(),
  getExemptDirs: () => {
    const cfg = loadConfig();
    const dirs = cfg.exemptDirs;
    if (!dirs.every((d): d is string => typeof d === "string")) return [];
    return dirs;
  },
  stderr: defaultStderr,
};

// ─── Contract ───────────────────────────────────────────────────────────────

export const ProtectedBranchGuard: SyncHookContract<ToolHookInput, ProtectedBranchGuardDeps> = {
  name: "ProtectedBranchGuard",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "Bash";
  },

  execute(
    input: ToolHookInput,
    deps: ProtectedBranchGuardDeps,
  ): Result<SyncHookJSONOutput, ResultError> {
    const command = getCommand(input);

    // Only check git mutation commands (commit, push, merge)
    if (!isGitMutation(command)) {
      return ok({ continue: true });
    }

    // Exempt configured directories (builtins + settings.json)
    const extraDirs = deps.getExemptDirs();
    if (isExemptDir(deps.getCwd(), extraDirs)) {
      return ok({ continue: true });
    }

    // Check current branch
    const branch = deps.getBranch();

    // Fail open if branch cannot be determined
    if (!branch) {
      deps.stderr("[ProtectedBranchGuard] Could not determine branch — allowing");
      return ok({ continue: true });
    }

    // Block if on a protected branch
    if (PROTECTED_BRANCHES.includes(branch)) {
      const reason = [
        `Protected branch guard: cannot run git mutations on '${branch}'.`,
        "",
        `Command: ${command.slice(0, 200)}`,
        "",
        "Create a feature branch first:",
        `  git checkout -b feature/your-feature`,
        "",
        "Then commit and push from the feature branch.",
        "",
        "To exempt this project, add to ~/.claude/settings.json:",
        `  "hookConfig": { "protectedBranchGuard": { "exemptDirs": ["your-project-dir"] } }`,
      ].join("\n");

      deps.stderr(`[ProtectedBranchGuard] BLOCK: git mutation on protected branch '${branch}'`);

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
