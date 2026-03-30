/**
 * GitignoreRecommender Contract — Recommend enabling respectGitignore at session start.
 *
 * Checks if the current project's .claude/settings.json or .claude/settings.local.json
 * has respectGitignore enabled. If not, injects additionalContext asking the AI to
 * offer to add it. Skips when running in the PAI root (~/.claude).
 */

import { join } from "node:path";
import { fileExists, readFile } from "@hooks/core/adapters/fs";
import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { fileReadFailed } from "@hooks/core/error";
import { ok, type Result, tryCatch } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import { continueOk } from "@hooks/core/types/hook-outputs";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GitignoreRecommenderDeps {
  fileExists: (path: string) => boolean;
  readFile: (path: string) => Result<string, PaiError>;
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
  stderr: (msg) => process.stderr.write(`${msg}\n`),
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

function parseJson(content: string, path: string): Result<Record<string, unknown>, PaiError> {
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

export const GitignoreRecommender: SyncHookContract<
  SessionStartInput,
  ContinueOutput,
  GitignoreRecommenderDeps
> = {
  name: "GitignoreRecommender",
  event: "SessionStart",

  accepts(_input: SessionStartInput): boolean {
    return true;
  },

  execute(
    _input: SessionStartInput,
    deps: GitignoreRecommenderDeps,
  ): Result<ContinueOutput, PaiError> {
    const projectDir = deps.cwd();

    // Skip for PAI root — it manages its own settings
    if (projectDir === deps.paiRoot) {
      return ok(continueOk());
    }

    // Check .claude/settings.json
    const settingsPath = join(projectDir, ".claude", "settings.json");
    if (fileHasRespectGitignore(settingsPath, deps)) {
      return ok(continueOk());
    }

    // Check .claude/settings.local.json
    const localSettingsPath = join(projectDir, ".claude", "settings.local.json");
    if (fileHasRespectGitignore(localSettingsPath, deps)) {
      return ok(continueOk());
    }

    // Neither file has it — inject recommendation
    deps.stderr("[GitignoreRecommender] respectGitignore not set — injecting recommendation");
    return ok(continueOk(RECOMMENDATION_CONTEXT));
  },

  defaultDeps,
};
