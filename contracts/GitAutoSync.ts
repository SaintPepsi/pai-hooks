/**
 * GitAutoSync Contract — Auto-commit and push ~/.claude on session end.
 *
 * Pipeline: check status → debounce → add → commit → backup → pull → push.
 * Runs as last SessionEnd hook so other hooks have written their changes.
 * Always returns SilentOutput — never blocks session end.
 */

import type { HookContract } from "../core/contract";
import type { SessionEndInput } from "../core/types/hook-inputs";
import type { SilentOutput } from "../core/types/hook-outputs";
import { ok, type Result } from "../core/result";
import type { PaiError } from "../core/error";
import { fileExists, readFile, ensureDir, removeFile, copyFile } from "../core/adapters/fs";
import { execSyncSafe, spawnBackground } from "../core/adapters/process";
import { join } from "path";
import { homedir } from "os";
import { getLocalTimestamp } from "../lib/time";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GitAutoSyncDeps {
  execSync: (cmd: string, opts?: Record<string, unknown>) => any;
  spawn: (cmd: string, args: string[], opts?: Record<string, unknown>) => { unref(): void };
  dateNow: () => number;
  exit: (code: number) => void;
  claudeDir: string;
  backupDir: string;
  debug: boolean;
  getTimestamp: () => string;
  mkdirSync: (path: string, opts?: { recursive?: boolean }) => string | undefined;
  copyFileSync: (src: string, dest: string) => void;
  readFileSync: (path: string) => string;
  existsSync: (path: string) => boolean;
  unlinkSync: (path: string) => void;
  stderr: (msg: string) => void;
}

interface BackupResult {
  dir: string;
  files: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const CLAUDE_DIR = join(homedir(), ".claude");
export const BACKUP_DIR = join(CLAUDE_DIR, ".backup");
export const DEBOUNCE_MINUTES = 15;

export const KEY_FILES = ["statusline-command.sh", "statusline-helpers.ts", "settings.json"];
export const KEY_HOOK_PATTERN = /^hooks\/.*\.ts$/;

// ─── Pure Logic Functions ────────────────────────────────────────────────────

function cleanupLock(deps: GitAutoSyncDeps): void {
  const lockPath = join(deps.claudeDir, ".git", "index.lock");
  if (deps.existsSync(lockPath)) {
    deps.unlinkSync(lockPath);
  }
}

function backupKeyFiles(deps: GitAutoSyncDeps): BackupResult | null {
  const files: string[] = [];

  for (const f of KEY_FILES) {
    if (deps.existsSync(join(deps.claudeDir, f))) {
      files.push(f);
    }
  }

  const hookFiles = String(deps.execSync("git ls-files hooks/", {
    cwd: deps.claudeDir,
    encoding: "utf-8",
    timeout: 5000,
  })).trim().split("\n").filter(f => KEY_HOOK_PATTERN.test(f));
  files.push(...hookFiles);

  if (files.length === 0) return null;

  const backupSetDir = join(deps.backupDir, String(deps.dateNow()));
  deps.mkdirSync(backupSetDir, { recursive: true });

  for (const file of files) {
    const src = join(deps.claudeDir, file);
    if (deps.existsSync(src)) {
      const flatName = file.replace(/\//g, "_") + ".pre-pull";
      deps.copyFileSync(src, join(backupSetDir, flatName));
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

    if (!deps.existsSync(backupFile) || !deps.existsSync(currentFile)) continue;

    const backupContent = deps.readFileSync(backupFile);
    const currentContent = deps.readFileSync(currentFile);
    if (backupContent !== currentContent) {
      deps.stderr(`GitAutoSync: WARNING — ${file} changed unexpectedly during merge pull`);
    }
  }
}

/**
 * Core git auto-sync pipeline.
 * Exported for backward compatibility with existing test suite.
 */
export function runGitAutoSync(deps: GitAutoSyncDeps = defaultDeps): void {
  try {
    const status = deps.execSync("git status --porcelain", {
      cwd: deps.claudeDir,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    if (!status) {
      deps.exit(0);
      return;
    }

    const lastCommitEpoch = deps.execSync(
      'git log -1 --format=%ct --grep="auto-sync"',
      { cwd: deps.claudeDir, encoding: "utf-8", timeout: 5000 }
    ).trim();

    if (lastCommitEpoch) {
      const elapsedMinutes = (deps.dateNow() / 1000 - Number(lastCommitEpoch)) / 60;
      if (elapsedMinutes < DEBOUNCE_MINUTES) {
        if (deps.debug) {
          deps.stderr(`GitAutoSync: debounced (${Math.round(elapsedMinutes)}m since last, need ${DEBOUNCE_MINUTES}m)`);
        }
        deps.exit(0);
        return;
      }
    }

    const timestamp = deps.getTimestamp();

    deps.execSync("git add -A", { cwd: deps.claudeDir, timeout: 5000 });
    deps.execSync(
      `git commit -m "auto-sync: session end ${timestamp}"`,
      { cwd: deps.claudeDir, timeout: 10000 }
    );

    const backup = backupKeyFiles(deps);

    deps.execSync("git pull --no-rebase origin main", {
      cwd: deps.claudeDir,
      timeout: 15000,
      stdio: "ignore",
    });

    if (backup) {
      checkPostMergeDiff(deps, backup);
    }

    const child = deps.spawn("git", ["push", "origin", "main"], {
      cwd: deps.claudeDir,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch (error: any) {
    cleanupLock(deps);
    if (deps.debug) {
      deps.stderr(`GitAutoSync: ${error.message}`);
    }
  }
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: GitAutoSyncDeps = {
  execSync: (cmd: string, opts?: Record<string, unknown>) => {
    const r = execSyncSafe(cmd, { cwd: opts?.cwd as string, timeout: opts?.timeout as number, stdio: opts?.stdio });
    if (!r.ok) throw r.error;
    return r.value;
  },
  spawn: (cmd: string, args: string[], opts?: Record<string, unknown>) => {
    spawnBackground(cmd, args, { cwd: opts?.cwd as string });
    return { unref() {} };
  },
  dateNow: () => Date.now(),
  exit: (code) => process.exit(code),
  claudeDir: CLAUDE_DIR,
  backupDir: BACKUP_DIR,
  debug: !!process.env.DEBUG,
  getTimestamp: getLocalTimestamp,
  mkdirSync: (path) => { ensureDir(path); return undefined; },
  copyFileSync: (src, dest) => { copyFile(src, dest); },
  readFileSync: (path) => {
    const r = readFile(path);
    if (!r.ok) throw r.error;
    return r.value;
  },
  existsSync: fileExists,
  unlinkSync: (path) => { removeFile(path); },
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export const GitAutoSync: HookContract<
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
    // Suppress exit calls — the runner handles exit
    const noExitDeps = { ...deps, exit: () => {} };
    runGitAutoSync(noExitDeps);
    return ok({ type: "silent" });
  },

  defaultDeps,
};
