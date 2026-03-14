/**
 * Article Writer Runner — Wrapper that runs claude synchronously and handles cleanup.
 *
 * Spawned by ArticleWriter as a detached bun process.
 * Imports buildArticlePrompt directly, runs claude -p in the ianhogers.dev repo,
 * then deterministically cleans up lock/cooldown files regardless of exit status.
 */

import { join } from "path";
import { spawnSyncSafe } from "@hooks/core/adapters/process";
import { writeFile, removeFile } from "@hooks/core/adapters/fs";
import { buildArticlePrompt } from "@hooks/contracts/ArticleWriter";

// ─── Types ──────────────────────────────────────────────────────────────────

const WEBSITE_REPO = "/Users/hogers/Projects/ianhogers.dev";

export interface RunnerDeps {
  spawnSyncSafe: typeof spawnSyncSafe;
  writeFile: typeof writeFile;
  removeFile: typeof removeFile;
  buildPrompt: typeof buildArticlePrompt;
  env: Record<string, string | undefined>;
  stderr: (msg: string) => void;
}

const defaultDeps: RunnerDeps = {
  spawnSyncSafe,
  writeFile,
  removeFile,
  buildPrompt: buildArticlePrompt,
  env: process.env as Record<string, string | undefined>,
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

// ─── Runner ─────────────────────────────────────────────────────────────────

export function run(
  baseDir: string,
  sessionId: string,
  deps: RunnerDeps = defaultDeps,
  cmd: string = "claude",
): void {
  const articlesDir = join(baseDir, "MEMORY/ARTICLES");
  const lockPath = join(articlesDir, ".writing");
  const cooldownPath = join(articlesDir, ".last-article");

  const prompt = deps.buildPrompt(baseDir, sessionId);

  // spawnSyncSafe wraps the call in Result — no try-catch needed.
  // It blocks until claude exits (success or failure), then we always clean up.
  const envWithoutClaudeCode = { ...deps.env, CLAUDECODE: undefined, MAPLE_ARTICLE_AGENT: "1" };
  deps.spawnSyncSafe(cmd, ["-p", prompt, "--max-turns", "25"], {
    cwd: WEBSITE_REPO,
    stdio: "ignore",
    timeout: 10 * 60 * 1000,
    env: envWithoutClaudeCode,
  });

  // Cleanup runs unconditionally after the sync call returns (success or error).
  // spawnSyncSafe never throws — it returns Result — so this always executes.
  deps.writeFile(cooldownPath, new Date().toISOString());
  deps.removeFile(lockPath);
}

// ─── Script entry point ─────────────────────────────────────────────────────

if (import.meta.main) {
  const [baseDir, sessionId] = process.argv.slice(2);
  if (!baseDir || !sessionId) {
    process.stderr.write("[article-writer-runner] Missing baseDir or sessionId argument\n");
    process.exit(1);
  }
  run(baseDir, sessionId);
}
