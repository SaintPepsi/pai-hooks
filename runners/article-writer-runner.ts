/**
 * Article Writer Runner — Wrapper that runs claude synchronously and handles cleanup.
 *
 * Spawned by ArticleWriter as a detached bun process.
 * Imports buildArticlePrompt directly, runs claude -p in the website repo,
 * then deterministically cleans up lock/cooldown files regardless of exit status.
 */

import { join } from "path";
import { spawnSyncSafe } from "@hooks/core/adapters/process";
import { writeFile, removeFile, appendFile } from "@hooks/core/adapters/fs";
import { buildArticlePrompt } from "@hooks/contracts/ArticleWriter";
import { getDAName, getPrincipalName } from "@hooks/lib/identity";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RunnerDeps {
  spawnSyncSafe: typeof spawnSyncSafe;
  writeFile: typeof writeFile;
  removeFile: typeof removeFile;
  appendFile: typeof appendFile;
  buildPrompt: typeof buildArticlePrompt;
  env: Record<string, string | undefined>;
  websiteRepo: string;
  principalName: string;
  daName: string;
  stderr: (msg: string) => void;
}

const defaultDeps: RunnerDeps = {
  spawnSyncSafe,
  writeFile,
  removeFile,
  appendFile,
  buildPrompt: buildArticlePrompt,
  env: process.env as Record<string, string | undefined>,
  websiteRepo: process.env.PAI_WEBSITE_REPO || "",
  principalName: getPrincipalName(),
  daName: getDAName(),
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

// ─── Logging ────────────────────────────────────────────────────────────────

function logEntry(logPath: string, message: string, deps: RunnerDeps): void {
  const timestamp = new Date().toISOString();
  deps.appendFile(logPath, `${timestamp} ${message}\n`);
}

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
  const logPath = join(articlesDir, ".writing-log");

  const prompt = deps.buildPrompt({
    baseDir,
    websiteRepo: deps.websiteRepo,
    principalName: deps.principalName,
    daName: deps.daName,
  }, sessionId);

  logEntry(logPath, "START article-writer-runner", deps);

  // spawnSyncSafe wraps the call in Result — never throws. Cleanup below always runs.
  const envWithoutClaudeCode = { ...deps.env, CLAUDECODE: undefined, MAPLE_ARTICLE_AGENT: "1" };
  const result = deps.spawnSyncSafe(cmd, ["-p", prompt, "--max-turns", "25"], {
    cwd: deps.websiteRepo,
    stdio: "ignore",
    timeout: 10 * 60 * 1000,
    env: envWithoutClaudeCode,
  });

  if (result.ok) {
    logEntry(logPath, `COMPLETE exit=${result.value.exitCode}`, deps);
  } else {
    logEntry(logPath, `ERROR ${result.error.message}`, deps);
  }

  // Cleanup runs unconditionally after the sync call returns.
  deps.writeFile(cooldownPath, new Date().toISOString());
  deps.removeFile(lockPath);
  logEntry(logPath, "CLEANUP lock removed, cooldown written", deps);
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
