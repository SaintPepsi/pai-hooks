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

import { readFile } from "@hooks/core/adapters/fs";
import { execSyncSafe } from "@hooks/core/adapters/process";
import type { SyncHookContract } from "@hooks/core/contract";
import { jsonParseFailed, type PaiError } from "@hooks/core/error";
import { ok, type Result, tryCatch } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { getCommand } from "@hooks/lib/tool-input";
import type { BlockOutput, ContinueOutput } from "@hooks/core/types/hook-outputs";
import { getSettingsPath } from "@hooks/lib/paths";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProtectedBranchGuardDeps {
  getBranch: () => string | null;
  getCwd: () => string;
  getExemptDirs: () => string[];
  stderr: (msg: string) => void;
}

interface SettingsJson {
  hookConfig?: {
    protectedBranchGuard?: {
      exemptDirs?: string[];
    };
  };
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PROTECTED_BRANCHES = ["main", "master"];

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

/** Extract exemptDirs from a parsed settings object. */
function extractExemptDirs(parsed: SettingsJson): string[] {
  const dirs = parsed.hookConfig?.protectedBranchGuard?.exemptDirs;
  if (!Array.isArray(dirs)) return [];
  if (!dirs.every((d): d is string => typeof d === "string")) return [];
  return dirs;
}

/**
 * Read exemptDirs from settings.json at hookConfig.protectedBranchGuard.exemptDirs.
 * Returns empty array if not configured or on any read/parse error (fails open).
 */
function readExemptDirsFromSettings(
  settingsPath: string,
  readFileFn: (path: string) => string | null,
): string[] {
  const raw = readFileFn(settingsPath);
  if (!raw) return [];
  const parseResult = tryCatch(
    () => JSON.parse(raw) as SettingsJson,
    (cause) => jsonParseFailed(raw.slice(0, 100), cause),
  );
  if (!parseResult.ok) return [];
  return extractExemptDirs(parseResult.value);
}

// ─── Default Deps ───────────────────────────────────────────────────────────

const defaultDeps: ProtectedBranchGuardDeps = {
  getBranch: () => {
    const result = execSyncSafe("git branch --show-current");
    if (!result.ok) return null;
    return result.value.trim() || null;
  },
  getCwd: () => process.cwd(),
  getExemptDirs: () =>
    readExemptDirsFromSettings(getSettingsPath(), (p) => {
      const r = readFile(p);
      return r.ok ? r.value : null;
    }),
  stderr: (msg) => process.stderr.write(`${msg}\n`),
};

// ─── Contract ───────────────────────────────────────────────────────────────

export const ProtectedBranchGuard: SyncHookContract<
  ToolHookInput,
  ContinueOutput | BlockOutput,
  ProtectedBranchGuardDeps
> = {
  name: "ProtectedBranchGuard",
  event: "PreToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "Bash";
  },

  execute(
    input: ToolHookInput,
    deps: ProtectedBranchGuardDeps,
  ): Result<ContinueOutput | BlockOutput, PaiError> {
    const command = getCommand(input);

    // Only check git mutation commands (commit, push, merge)
    if (!isGitMutation(command)) {
      return ok({ type: "continue", continue: true });
    }

    // Exempt configured directories (builtins + settings.json)
    const extraDirs = deps.getExemptDirs();
    if (isExemptDir(deps.getCwd(), extraDirs)) {
      return ok({ type: "continue", continue: true });
    }

    // Check current branch
    const branch = deps.getBranch();

    // Fail open if branch cannot be determined
    if (!branch) {
      deps.stderr("[ProtectedBranchGuard] Could not determine branch — allowing");
      return ok({ type: "continue", continue: true });
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
        type: "block",
        decision: "block",
        reason,
      });
    }

    return ok({ type: "continue", continue: true });
  },

  defaultDeps,
};
