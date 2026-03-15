/**
 * GitAutoSync Contract — Auto-commit and push ~/.claude on session end.
 *
 * Pipeline: check status → debounce → add → commit → backup → pull → push.
 * Runs as last SessionEnd hook so other hooks have written their changes.
 * Always returns SilentOutput — never blocks session end.
 */

import type { SyncHookContract } from "@hooks/core/contract";
import type { SessionEndInput } from "@hooks/core/types/hook-inputs";
import type { SilentOutput } from "@hooks/core/types/hook-outputs";
import { ok, type Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import { fileExists, readFile, ensureDir, removeFile, copyFile, stat } from "@hooks/core/adapters/fs";
import { execSyncSafe, spawnBackground } from "@hooks/core/adapters/process";
import { join } from "path";
import { homedir } from "os";
import { getLocalTimestamp } from "@hooks/lib/time";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GitAutoSyncDeps {
  execSync: (cmd: string, opts?: { cwd?: string; timeout?: number }) => Result<string, PaiError>;
  spawnBackground: (cmd: string, args: string[], opts?: { cwd?: string }) => Result<void, PaiError>;
  fileExists: (path: string) => boolean;
  readFile: (path: string) => Result<string, PaiError>;
  ensureDir: (path: string) => Result<void, PaiError>;
  copyFile: (src: string, dest: string) => Result<void, PaiError>;
  removeFile: (path: string) => Result<void, PaiError>;
  stat: (path: string) => Result<{ mtimeMs: number }, PaiError>;
  dateNow: () => number;
  getTimestamp: () => string;
  claudeDir: string;
  backupDir: string;
  stderr: (msg: string) => void;
}

interface BackupResult {
  dir: string;
  files: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEBOUNCE_MINUTES = 15;
export const STALE_LOCK_MINUTES = 2;
export const KEY_FILES = ["statusline-command.sh", "statusline-helpers.ts", "settings.json"];
export const KEY_HOOK_PATTERN = /^(?:hooks|pai-hooks\/hooks)\/.*\.ts$/;

// ─── Pure Logic Functions ────────────────────────────────────────────────────

/**
 * Returns true if another git process holds index.lock — meaning an active
 * session is doing git operations. GitAutoSync should skip entirely rather
 * than force-remove the lock (which causes the race condition).
 *
 * Stale lock detection: if the lock file is older than STALE_LOCK_MINUTES,
 * it was left behind by a crashed/timed-out git operation. Remove it and
 * proceed rather than permanently blocking all future syncs.
 */
function isGitBusy(deps: GitAutoSyncDeps): boolean {
  const lockPath = join(deps.claudeDir, ".git", "index.lock");
  if (!deps.fileExists(lockPath)) return false;

  const statResult = deps.stat(lockPath);
  if (!statResult.ok) {
    // Can't determine age — assume active, skip safely
    return true;
  }

  const ageMinutes = (deps.dateNow() - statResult.value.mtimeMs) / (1000 * 60);
  if (ageMinutes > STALE_LOCK_MINUTES) {
    deps.stderr(
      `[GitAutoSync] Removing stale index.lock (${Math.round(ageMinutes)}m old, threshold ${STALE_LOCK_MINUTES}m)`,
    );
    deps.removeFile(lockPath);
    return false;
  }

  return true;
}

function isDebounced(deps: GitAutoSyncDeps): boolean {
  const lastCommitResult = deps.execSync(
    'git log -1 --format=%ct --grep="auto-sync"',
    { cwd: deps.claudeDir, timeout: 5000 },
  );
  if (!lastCommitResult.ok) return false;

  const epoch = lastCommitResult.value.trim();
  if (!epoch) return false;

  const elapsedMinutes = (deps.dateNow() / 1000 - Number(epoch)) / 60;
  if (elapsedMinutes < DEBOUNCE_MINUTES) {
    deps.stderr(
      `[GitAutoSync] Debounced (${Math.round(elapsedMinutes)}m since last, need ${DEBOUNCE_MINUTES}m)`,
    );
    return true;
  }

  return false;
}

function backupKeyFiles(deps: GitAutoSyncDeps): BackupResult | null {
  const files: string[] = [];

  for (const f of KEY_FILES) {
    if (deps.fileExists(join(deps.claudeDir, f))) {
      files.push(f);
    }
  }

  const hookFilesResult = deps.execSync("git ls-files pai-hooks/hooks/", {
    cwd: deps.claudeDir,
    timeout: 5000,
  });
  if (hookFilesResult.ok) {
    const hookFiles = hookFilesResult.value
      .trim()
      .split("\n")
      .filter((f) => KEY_HOOK_PATTERN.test(f));
    files.push(...hookFiles);
  }

  if (files.length === 0) return null;

  const backupSetDir = join(deps.backupDir, String(deps.dateNow()));
  deps.ensureDir(backupSetDir);

  for (const file of files) {
    const src = join(deps.claudeDir, file);
    if (deps.fileExists(src)) {
      const flatName = file.replace(/\//g, "_") + ".pre-pull";
      deps.copyFile(src, join(backupSetDir, flatName));
    }
  }

  return { dir: backupSetDir, files };
}

function checkPostMergeDiff(deps: GitAutoSyncDeps, backup: BackupResult): void {
  for (const file of backup.files) {
    if (!KEY_FILES.includes(file) && !KEY_HOOK_PATTERN.test(file)) continue;

    const flatName = file.replace(/\//g, "_") + ".pre-pull";
    const backupFile = join(backup.dir, flatName);
    const currentFile = join(deps.claudeDir, file);

    if (!deps.fileExists(backupFile) || !deps.fileExists(currentFile)) continue;

    const backupContent = deps.readFile(backupFile);
    const currentContent = deps.readFile(currentFile);
    if (!backupContent.ok || !currentContent.ok) continue;

    if (backupContent.value !== currentContent.value) {
      deps.stderr(`GitAutoSync: WARNING — ${file} changed unexpectedly during merge pull`);
    }
  }
}

// ─── Default Deps ────────────────────────────────────────────────────────────

const BASE_DIR = join(homedir(), ".claude");

const defaultDeps: GitAutoSyncDeps = {
  execSync: execSyncSafe,
  spawnBackground,
  fileExists,
  readFile,
  ensureDir,
  copyFile,
  removeFile,
  stat,
  dateNow: () => Date.now(),
  getTimestamp: getLocalTimestamp,
  claudeDir: BASE_DIR,
  backupDir: join(BASE_DIR, ".backup"),
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

// ─── Contract ────────────────────────────────────────────────────────────────

export const GitAutoSync: SyncHookContract<
  SessionEndInput,
  SilentOutput,
  GitAutoSyncDeps
> = {
  name: "GitAutoSync",
  event: "SessionEnd",

  accepts(_input: SessionEndInput): boolean {
    return true;
  },

  execute(
    _input: SessionEndInput,
    deps: GitAutoSyncDeps,
  ): Result<SilentOutput, PaiError> {
    // 0. Skip if another session is actively using git
    if (isGitBusy(deps)) {
      deps.stderr("[GitAutoSync] Skipped — index.lock exists (active session using git)");
      return ok({ type: "silent" });
    }

    // 1. Check for uncommitted changes
    const statusResult = deps.execSync("git status --porcelain", {
      cwd: deps.claudeDir,
      timeout: 5000,
    });
    if (!statusResult.ok) {
      deps.stderr(`[GitAutoSync] git status failed: ${statusResult.error.message}`);
      return ok({ type: "silent" });
    }

    if (!statusResult.value.trim()) {
      deps.stderr("[GitAutoSync] No changes to sync");
      return ok({ type: "silent" });
    }

    // 2. Debounce — skip if last auto-sync was recent
    if (isDebounced(deps)) {
      return ok({ type: "silent" });
    }

    // 3. Stage all changes
    const addResult = deps.execSync("git add -A", {
      cwd: deps.claudeDir,
      timeout: 15000,
    });
    if (!addResult.ok) {
      deps.stderr(`[GitAutoSync] git add failed: ${addResult.error.message}`);
      // Clean up stale lock if the operation left one behind
      const lockPath = join(deps.claudeDir, ".git", "index.lock");
      if (deps.fileExists(lockPath)) {
        deps.removeFile(lockPath);
      }
      return ok({ type: "silent" });
    }

    // 4. Commit
    const timestamp = deps.getTimestamp();
    const commitResult = deps.execSync(
      `git commit -m "auto-sync: session end ${timestamp}"`,
      { cwd: deps.claudeDir, timeout: 20000 },
    );
    if (!commitResult.ok) {
      deps.stderr(`[GitAutoSync] git commit failed: ${commitResult.error.message}`);
      // Clean up stale lock if the operation left one behind
      const lockPath = join(deps.claudeDir, ".git", "index.lock");
      if (deps.fileExists(lockPath)) {
        deps.removeFile(lockPath);
      }
      return ok({ type: "silent" });
    }

    // 5. Backup key files before pull
    const backup = backupKeyFiles(deps);

    // 6. Pull with merge
    const pullResult = deps.execSync("git pull --no-rebase origin main", {
      cwd: deps.claudeDir,
      timeout: 15000,
    });
    if (!pullResult.ok) {
      deps.stderr(`[GitAutoSync] git pull failed: ${pullResult.error.message}`);
      return ok({ type: "silent" });
    }

    // 7. Verify no key files changed unexpectedly
    if (backup) {
      checkPostMergeDiff(deps, backup);
    }

    // 8. Push in background
    deps.spawnBackground("git", ["push", "origin", "main"], {
      cwd: deps.claudeDir,
    });

    deps.stderr("[GitAutoSync] Synced and pushing to origin");
    return ok({ type: "silent" });
  },

  defaultDeps,
};
