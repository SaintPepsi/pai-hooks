/**
 * GitignoreRecommender Contract — Recommend enabling respectGitignore at session start.
 *
 * Checks if the current project's .claude/settings.json or .claude/settings.local.json
 * has respectGitignore enabled. If not, injects additionalContext via
 * hookSpecificOutput (SessionStart) asking the AI to offer to add it.
 * Skips when running in the PAI root (~/.claude).
 */

import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { fileExists, readFile } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { fileReadFailed } from "@hooks/core/error";
import { ok, type Result, tryCatch } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import { defaultStderr } from "@hooks/lib/paths";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GitignoreRecommenderDeps {
  fileExists: (path: string) => boolean;
  readFile: (path: string) => Result<string, ResultError>;
  cwd: () => string;
  paiRoot: string;
  stderr: (msg: string) => void;
}

// ─── Default Deps ─────────────────────────────────────────────────────────────

const defaultDeps: GitignoreRecommenderDeps = {
  fileExists,
  readFile,
  cwd: () => process.cwd(),
  paiRoot: join(process.env.HOME ?? "/", ".claude"),
  stderr: defaultStderr,
};

// ─── Pure Logic ───────────────────────────────────────────────────────────────

const RECOMMENDATION_CONTEXT = [
  "This project does not have respectGitignore enabled.",
  "Consider asking the user:",
  "  'This project doesn't have respectGitignore enabled in .claude/settings.local.json.",
  "   Would you like me to add it? This prevents reading gitignored files like .env and credentials.'",
  'If they approve, write {"respectGitignore": true} to .claude/settings.local.json',
  "(merging with existing content if the file exists).",
].join(" ");

function parseJson(content: string, path: string): Result<Record<string, unknown>, ResultError> {
  return tryCatch(
    () => JSON.parse(content) as Record<string, unknown>,
    (e) => fileReadFailed(path, e),
  );
}

function fileHasRespectGitignore(path: string, deps: GitignoreRecommenderDeps): boolean {
  if (!deps.fileExists(path)) return false;
  const readResult = deps.readFile(path);
  if (!readResult.ok) return false;
  const parseResult = parseJson(readResult.value, path);
  if (!parseResult.ok) return false;
  return parseResult.value.respectGitignore === true;
}

// ─── Contract ─────────────────────────────────────────────────────────────────

export const GitignoreRecommender: SyncHookContract<SessionStartInput, GitignoreRecommenderDeps> = {
  name: "GitignoreRecommender",
  event: "SessionStart",

  accepts(_input: SessionStartInput): boolean {
    return true;
  },

  execute(
    _input: SessionStartInput,
    deps: GitignoreRecommenderDeps,
  ): Result<SyncHookJSONOutput, ResultError> {
    const projectDir = deps.cwd();

    // Skip for PAI root — it manages its own settings
    if (projectDir === deps.paiRoot) {
      return ok({ continue: true });
    }

    // Check .claude/settings.json
    const settingsPath = join(projectDir, ".claude", "settings.json");
    if (fileHasRespectGitignore(settingsPath, deps)) {
      return ok({ continue: true });
    }

    // Check .claude/settings.local.json
    const localSettingsPath = join(projectDir, ".claude", "settings.local.json");
    if (fileHasRespectGitignore(localSettingsPath, deps)) {
      return ok({ continue: true });
    }

    // Neither file has it — inject recommendation (R2: SessionStart hookSpecificOutput.additionalContext)
    deps.stderr("[GitignoreRecommender] respectGitignore not set — injecting recommendation");
    return ok({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: RECOMMENDATION_CONTEXT,
      },
    });
  },

  defaultDeps,
};
