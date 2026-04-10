/**
 * ArticleWriter Agent Runner — Resolves repo, builds prompt, spawns via spawnAgent().
 *
 * Thin wrapper modeled after hooks/SecurityValidator/run-hardening.ts.
 * Resolves the GitHub repo slug to a local cached clone, builds the article
 * prompt, then delegates to spawnAgent() for lock/log/background spawning.
 *
 * Importable function only — no CLI entry point.
 */

import { join } from "node:path";
import { buildArticlePrompt } from "@hooks/hooks/WorkLifecycle/ArticleWriter/ArticleWriter.contract";
import { ensureDir, fileExists } from "@hooks/core/adapters/fs";
import { spawnSyncSafe } from "@hooks/core/adapters/process";
import { spawnAgent, type SpawnAgentConfig, type SpawnAgentDeps } from "@hooks/lib/spawn-agent";
import { err, ok, type Result } from "@hooks/core/result";
import { processSpawnFailed, type ResultError } from "@hooks/core/error";
import { readHookConfig } from "@hooks/lib/hook-config";
import { getDAName, getPrincipalName } from "@hooks/lib/identity";
import { getPaiDir } from "@hooks/lib/paths";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface RunArticleWriterDeps {
  spawnAgent: (config: SpawnAgentConfig, deps?: SpawnAgentDeps) => Result<void, ResultError>;
  spawnSyncSafe: typeof spawnSyncSafe;
  fileExists: (path: string) => boolean;
  ensureDir: (path: string) => Result<void, ResultError>;
  stderr: (msg: string) => void;
  baseDir: string;
  websiteRepo: string;
  cacheDir: string;
  principalName: string;
  daName: string;
}

// ─── Defaults ──────────────────────────────────────────────────────────────

const baseDir = getPaiDir();

const defaultDeps: RunArticleWriterDeps = {
  spawnAgent,
  spawnSyncSafe,
  fileExists,
  ensureDir,
  stderr: (msg) => process.stderr.write(`${msg}\n`),
  baseDir,
  websiteRepo: readHookConfig<{ repo?: string }>("articleWriter")?.repo || "",
  cacheDir: join(baseDir, "cache/repos"),
  principalName: getPrincipalName(),
  daName: getDAName(),
};

// ─── Repo Resolution ───────────────────────────────────────────────────────

function resolveRepoDir(
  repoSlug: string,
  deps: RunArticleWriterDeps,
): Result<string, ResultError> {
  const localPath = join(deps.cacheDir, repoSlug);

  if (deps.fileExists(localPath)) {
    // Cached — fetch latest
    const fetchResult = deps.spawnSyncSafe("git", ["fetch", "origin"], {
      cwd: localPath,
      timeout: 30000,
    });
    if (!fetchResult.ok) {
      deps.stderr(`[run-article-writer] git fetch failed: ${fetchResult.error.message}`);
    }
    return ok(localPath);
  }

  // Clone fresh
  deps.ensureDir(deps.cacheDir);
  const cloneResult = deps.spawnSyncSafe("gh", ["repo", "clone", repoSlug, localPath], {
    timeout: 60000,
  });

  if (!cloneResult.ok) {
    deps.stderr(`[run-article-writer] clone failed: ${cloneResult.error.message}`);
    return err(processSpawnFailed("gh", cloneResult.error));
  }

  return ok(localPath);
}

// ─── Public API ────────────────────────────────────────────────────────────

export function runArticleWriter(
  sessionId: string,
  deps: RunArticleWriterDeps = defaultDeps,
): Result<void, ResultError> {
  // Resolve GitHub slug to local cached clone
  const repoDirResult = resolveRepoDir(deps.websiteRepo, deps);
  if (!repoDirResult.ok) {
    return repoDirResult;
  }
  const repoDir = repoDirResult.value;

  // Build prompt
  const prompt = buildArticlePrompt(
    {
      baseDir: deps.baseDir,
      websiteRepo: repoDir,
      principalName: deps.principalName,
      daName: deps.daName,
    },
    sessionId,
  );

  deps.stderr(`[run-article-writer] Spawning article writer agent for session: ${sessionId}`);

  return deps.spawnAgent({
    prompt,
    lockPath: join(deps.baseDir, "MEMORY/ARTICLES/.writing"),
    logPath: join(deps.baseDir, "MEMORY/ARTICLES/article-writer-log.jsonl"),
    source: "ArticleWriter",
    reason: "session-had-substantial-work",
    model: "opus",
    maxTurns: 25,
    timeout: 600_000,
    cwd: repoDir,
    claudeArgs: ["--setting-sources", ""],
  });
}
