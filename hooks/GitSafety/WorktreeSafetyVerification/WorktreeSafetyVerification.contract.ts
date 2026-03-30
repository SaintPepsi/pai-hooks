/**
 * WorktreeSafetyVerification Contract — Safety checks after EnterWorktree.
 *
 * 1. .gitignore check
 * 2. Dependency install (background)
 * 3. Baseline tests (background)
 *
 * Always returns ContinueOutput — never blocks worktree creation.
 */

import { dirname, join } from "node:path";
import { appendFile, ensureDir, fileExists, writeFile } from "@hooks/core/adapters/fs";
import { execSyncSafe, spawnBackground } from "@hooks/core/adapters/process";
import type { SyncHookContract } from "@hooks/core/contract";
import type { PaiError } from "@hooks/core/error";
import { map, ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { continueOk } from "@hooks/core/types/hook-outputs";
import { defaultStderr } from "@hooks/lib/paths";
import type { ContinueOutput } from "@hooks/core/types/hook-outputs";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WorktreeSafetyDeps {
  execSync: (cmd: string, opts?: Record<string, unknown>) => Result<string, PaiError>;
  spawnSync: (
    cmd: string,
    args: string[],
    opts?: Record<string, unknown>,
  ) => { status: number | null };
  spawn: (cmd: string, args: string[], opts?: Record<string, unknown>) => { unref(): void };
  existsSync: (path: string) => boolean;
  appendFileSync: (path: string, content: string) => void;
  writeFileSync: (path: string, content: string) => void;
  mkdirSync: (path: string, opts?: Record<string, unknown>) => void;
  stderr: (msg: string) => void;
  cwd: () => string;
}

export interface DepInstallConfig {
  marker: string;
  commands: string[];
  name: string;
}

export interface TestConfig {
  marker: string;
  command: string[];
  name: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEP_CONFIGS: DepInstallConfig[] = [
  { marker: "bun.lockb", commands: ["bun install"], name: "Bun" },
  { marker: "package-lock.json", commands: ["npm install"], name: "npm" },
  { marker: "package.json", commands: ["bun install"], name: "Bun (package.json)" },
  { marker: "Cargo.toml", commands: ["cargo build"], name: "Cargo" },
  { marker: "poetry.lock", commands: ["poetry install"], name: "Poetry" },
  { marker: "pyproject.toml", commands: ["pip install -e ."], name: "pip (pyproject)" },
  { marker: "requirements.txt", commands: ["pip install -r requirements.txt"], name: "pip" },
  { marker: "go.mod", commands: ["go mod download"], name: "Go" },
];

export const TEST_CONFIGS: TestConfig[] = [
  { marker: "bun.lockb", command: ["bun", "test"], name: "bun test" },
  { marker: "package.json", command: ["bun", "test"], name: "bun test" },
  { marker: "Cargo.toml", command: ["cargo", "test"], name: "cargo test" },
  { marker: "pyproject.toml", command: ["python", "-m", "pytest"], name: "pytest" },
  { marker: "requirements.txt", command: ["python", "-m", "pytest"], name: "pytest" },
  { marker: "go.mod", command: ["go", "test", "./..."], name: "go test" },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Map deps.execSync Result, trimming the output string on success. */
function tryExec(
  deps: WorktreeSafetyDeps,
  cmd: string,
  opts?: Record<string, unknown>,
): Result<string, PaiError> {
  return map(deps.execSync(cmd, opts), (v) => v.trim());
}

// ─── Pure Logic Functions ────────────────────────────────────────────────────

export function extractWorktreePath(input: ToolHookInput): string | null {
  const response = input.tool_response;

  if (typeof response === "string") {
    const pathMatch = response.match(/(?:worktree[^:]*:\s*|at\s+|path:\s*)([/~][^\s,'"]+)/i);
    if (pathMatch) return pathMatch[1];
    const absMatch = response.match(/([/][a-zA-Z0-9._\-/]+\/\.pait\/worktrees\/[^\s,'"]+)/);
    if (absMatch) return absMatch[1];
    const genericMatch = response.match(/`([/][^`]+)`/);
    if (genericMatch) return genericMatch[1];
  }

  const toolInput = input.tool_input;
  for (const key of ["worktree_path", "path", "worktree", "directory"]) {
    if (typeof toolInput[key] === "string") return toolInput[key] as string;
  }

  if (typeof response === "object" && response !== null) {
    const resp = response as unknown as Record<string, unknown>;
    for (const key of ["worktree_path", "path", "worktree", "directory"]) {
      if (typeof resp[key] === "string") return resp[key] as string;
    }
  }

  return null;
}

export function findGitRoot(dir: string, deps: WorktreeSafetyDeps): string | null {
  const result = tryExec(deps, "git rev-parse --show-toplevel", {
    cwd: dir,
    encoding: "utf-8",
    timeout: 5000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return result.ok ? result.value || null : null;
}

export function ensureGitignore(worktreePath: string, deps: WorktreeSafetyDeps): void {
  const parentDir = dirname(worktreePath);
  const gitRoot = findGitRoot(parentDir, deps);

  if (!gitRoot) {
    deps.stderr(
      "[WorktreeSafety] \u26a0\ufe0f  Could not find git root for worktree parent \u2014 skipping .gitignore check",
    );
    return;
  }

  const checkResult = tryExec(deps, `git check-ignore -q "${worktreePath}"`, {
    cwd: gitRoot,
    timeout: 5000,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (checkResult.ok) {
    deps.stderr("[WorktreeSafety] \u2713 Worktree directory is in .gitignore");
    return;
  }

  // Inspect the error cause for exit code
  const cause = checkResult.error.cause as unknown as Record<string, unknown>;
  const exitCode = cause?.status ?? cause?.code;

  if (exitCode === 1) {
    deps.stderr(
      "[WorktreeSafety] \u26a0\ufe0f  Worktree directory not in .gitignore \u2014 adding entry",
    );
    const gitignorePath = join(gitRoot, ".gitignore");
    let entry: string;
    if (worktreePath.startsWith(`${gitRoot}/`)) {
      entry = worktreePath.slice(gitRoot.length + 1);
    } else {
      entry = worktreePath;
    }

    const content = `\n# Worktree (auto-added by WorktreeSafetyVerification)\n${entry}/\n`;
    deps.appendFileSync(gitignorePath, content);

    const commitResult = tryExec(
      deps,
      `git add .gitignore && git commit -m "chore: add worktree dir to .gitignore [skip ci]"`,
      {
        cwd: gitRoot,
        timeout: 15000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    if (commitResult.ok) {
      deps.stderr(`[WorktreeSafety] \u2713 Added "${entry}/" to .gitignore and committed`);
    } else {
      deps.stderr(
        `[WorktreeSafety] \u26a0\ufe0f  Failed to update .gitignore: ${commitResult.error.message}`,
      );
    }
  } else {
    deps.stderr(
      `[WorktreeSafety] \u26a0\ufe0f  git check-ignore failed (exit ${exitCode}) \u2014 skipping .gitignore check`,
    );
  }
}

export function installDependencies(worktreePath: string, deps: WorktreeSafetyDeps): void {
  for (const config of DEP_CONFIGS) {
    if (deps.existsSync(join(worktreePath, config.marker))) {
      deps.stderr(
        `[WorktreeSafety] \ud83d\udce6 Detected ${config.name} \u2014 running "${config.commands[0]}" in background`,
      );
      const [cmd, ...args] = config.commands[0].split(" ");
      const child = deps.spawn(cmd, args, { cwd: worktreePath, detached: true, stdio: "ignore" });
      child.unref();
      return;
    }
  }
  deps.stderr(
    "[WorktreeSafety] \u2139\ufe0f  No recognized dependency manifest found \u2014 skipping dep install",
  );
}

export function runBaselineTests(worktreePath: string, deps: WorktreeSafetyDeps): void {
  for (const config of TEST_CONFIGS) {
    if (deps.existsSync(join(worktreePath, config.marker))) {
      deps.stderr(
        `[WorktreeSafety] \ud83e\uddea Running baseline tests (${config.name}) in background`,
      );
      const [cmd, ...args] = config.command;
      const child = deps.spawn(cmd, args, { cwd: worktreePath, detached: true, stdio: "ignore" });
      child.unref();
      deps.stderr(
        `[WorktreeSafety] \u2139\ufe0f  If baseline tests fail, this indicates pre-existing issues.\n` +
          `[WorktreeSafety]    Check manually: cd ${worktreePath} && ${config.command.join(" ")}`,
      );
      return;
    }
  }
  deps.stderr(
    "[WorktreeSafety] \u2139\ufe0f  No recognized test suite found \u2014 skipping baseline test run",
  );
}

// ─── Contract ────────────────────────────────────────────────────────────────

const defaultDeps: WorktreeSafetyDeps = {
  execSync: (cmd: string, opts?: Record<string, unknown>) =>
    execSyncSafe(cmd, {
      cwd: opts?.cwd as string,
      timeout: opts?.timeout as number,
      stdio: opts?.stdio as "pipe" | "ignore" | "inherit" | undefined,
    }),
  spawnSync: (cmd: string, args: string[], opts?: Record<string, unknown>) => {
    const r = execSyncSafe([cmd, ...args].join(" "), {
      cwd: opts?.cwd as string,
      timeout: opts?.timeout as number,
    });
    return { status: r.ok ? 0 : -1 };
  },
  spawn: (cmd: string, args: string[], opts?: Record<string, unknown>) => {
    spawnBackground(cmd, args, { cwd: opts?.cwd as string });
    return { unref: () => {} };
  },
  existsSync: fileExists,
  appendFileSync: (path: string, content: string) => {
    appendFile(path, content);
  },
  writeFileSync: (path: string, content: string) => {
    writeFile(path, content);
  },
  mkdirSync: (path: string) => {
    ensureDir(path);
  },
  stderr: defaultStderr,
  cwd: () => process.cwd(),
};

export const WorktreeSafetyVerification: SyncHookContract<
  ToolHookInput,
  ContinueOutput,
  WorktreeSafetyDeps
> = {
  name: "WorktreeSafetyVerification",
  event: "PostToolUse",

  accepts(input: ToolHookInput): boolean {
    return input.tool_name === "EnterWorktree";
  },

  execute(input: ToolHookInput, deps: WorktreeSafetyDeps): Result<ContinueOutput, PaiError> {
    const worktreePath = extractWorktreePath(input);

    if (!worktreePath) {
      deps.stderr(
        "[WorktreeSafety] \u26a0\ufe0f  Could not determine worktree path from EnterWorktree response \u2014 skipping safety checks",
      );
      return ok(continueOk());
    }

    if (!deps.existsSync(worktreePath)) {
      deps.stderr(
        `[WorktreeSafety] \u26a0\ufe0f  Worktree path does not exist: ${worktreePath} \u2014 skipping safety checks`,
      );
      return ok(continueOk());
    }

    deps.stderr(
      `[WorktreeSafety] \ud83d\udd0d Running safety checks for worktree: ${worktreePath}`,
    );

    ensureGitignore(worktreePath, deps);
    installDependencies(worktreePath, deps);
    runBaselineTests(worktreePath, deps);

    return ok(continueOk());
  },

  defaultDeps,
};
