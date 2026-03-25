/**
 * Compiler — Builds hooks into single-file executables via bun build.
 *
 * Two output modes:
 *   --compiled:    bun build --target=node → .js with #!/usr/bin/env node shebang
 *   --compiled-ts: bun build --bundle      → .ts with #!/usr/bin/env bun shebang
 *
 * Both modes use atomic writes (temp file → rename) and chmod 0o755.
 * The --compiled mode substitutes core/adapters/stdin.ts with node-stdin-shim.ts
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-ac7f9ecc/cli/core/node-stdin-shim.ts)
 * to eliminate Bun.* globals from Node output.
 *
 * process.env is NOT inlined at build time — hooks read env at runtime.
 *
 * Uses CliDeps for filesystem ops and CompilerDeps.exec for bun build invocation
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-ac7f9ecc/cli/types/deps.ts).
 */

import type { Result } from "@hooks/cli/core/result";
import { ok, err } from "@hooks/cli/core/result";
import type { PaihError } from "@hooks/cli/core/error";
import { buildFailed } from "@hooks/cli/core/error";
import type { CliDeps } from "@hooks/cli/types/deps";
import type { ExecResult } from "@hooks/cli/adapters/process";
import type { OutputMode } from "@hooks/cli/types/lockfile";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CompiledMeta {
  /** Absolute path to the compiled output file. */
  outputPath: string;
  /** Output mode that produced this file. */
  outputMode: OutputMode;
  /** Shebang line prepended to the output. */
  shebang: string;
  /** Size of the compiled output in bytes. */
  size: number;
}

export interface CompilerDeps extends CliDeps {
  /** Execute a shell command. Returns ExecResult with stdout/stderr/exitCode. */
  exec: (cmd: string, opts?: { cwd?: string }) => Result<ExecResult, PaihError>;
  /** Set file permissions (chmod). */
  chmod: (path: string, mode: number) => Result<void, PaihError>;
  /** Rename a file atomically (temp → final). */
  rename: (src: string, dest: string) => Result<void, PaihError>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const NODE_SHEBANG = "#!/usr/bin/env node";
const BUN_SHEBANG = "#!/usr/bin/env bun";
const EXECUTABLE_MODE = 0o755;

// ─── Public API ─────────────────────────────────────────────────────────────

/** Options for compileHook — keeps parameter count under 5. */
export interface CompileHookOpts {
  /** Absolute path to the hook entry .ts file. */
  hookPath: string;
  /** "compiled" (Node target) or "compiled-ts" (Bun target). */
  mode: OutputMode;
  /** Absolute path to the output directory (.claude/hooks/<Group>/<Hook>/). */
  outputDir: string;
  /** Base name for the output file (e.g. "TypeStrictness"). */
  outputName: string;
  /** Root of the source repo (for locating the node-stdin-shim). */
  sourceRoot: string;
}

/**
 * Compile a hook into a single-file executable.
 *
 * Uses bun build to bundle the hook entry point and all its dependencies
 * into a single file with the appropriate shebang.
 */
export function compileHook(
  opts: CompileHookOpts,
  deps: CompilerDeps,
): Result<CompiledMeta, PaihError> {
  const { hookPath, mode, outputDir, outputName, sourceRoot } = opts;

  if (mode === "source") {
    return err(buildFailed("compileHook called with mode 'source'"));
  }

  const extension = mode === "compiled" ? ".js" : ".ts";
  const shebang = mode === "compiled" ? NODE_SHEBANG : BUN_SHEBANG;
  const finalPath = `${outputDir}/${outputName}${extension}`;
  const tempPath = `${finalPath}.tmp`;

  // Step 1: Run bun build
  const buildResult = runBunBuild({ entryPath: hookPath, outfile: tempPath, mode, sourceRoot }, deps);
  if (!buildResult.ok) return buildResult;

  // Step 2: Read the temp output
  const readResult = deps.readFile(tempPath);
  if (!readResult.ok) {
    return err(buildFailed(`Failed to read build output at ${tempPath}`));
  }

  // Step 3: Prepend shebang
  const withShebang = `${shebang}\n${readResult.value}`;

  // Step 4: Write shebanged content to a new temp file
  const shebangTempPath = `${finalPath}.shebang.tmp`;
  const writeResult = deps.writeFile(shebangTempPath, withShebang);
  if (!writeResult.ok) {
    return err(buildFailed(`Failed to write shebanged output at ${shebangTempPath}`));
  }

  // Step 5: Atomic rename to final path
  const renameResult = deps.rename(shebangTempPath, finalPath);
  if (!renameResult.ok) {
    return err(buildFailed(`Failed to rename ${shebangTempPath} → ${finalPath}`));
  }

  // Step 6: chmod 0o755
  const chmodResult = deps.chmod(finalPath, EXECUTABLE_MODE);
  if (!chmodResult.ok) {
    return err(buildFailed(`Failed to chmod ${finalPath}`));
  }

  const meta: CompiledMeta = {
    outputPath: finalPath,
    outputMode: mode,
    shebang,
    size: withShebang.length,
  };

  return ok(meta);
}

/**
 * Derive the settings.json command string for a compiled hook.
 *
 * --compiled:    direct path format (relies on shebang), e.g. "./.claude/hooks/Group/Hook.js"
 * --compiled-ts: bun <path> format, e.g. "bun ./.claude/hooks/Group/Hook.ts"
 */
export function compiledCommandString(
  relativePath: string,
  mode: OutputMode,
): string {
  if (mode === "compiled-ts") {
    return `bun ${relativePath}`;
  }
  // "compiled" and "source" both use direct path format
  return relativePath;
}

// ─── Internal ───────────────────────────────────────────────────────────────

/** Build command arguments derived from CompileHookOpts. */
interface BunBuildOpts {
  entryPath: string;
  outfile: string;
  mode: OutputMode;
  sourceRoot: string;
}

function runBunBuild(
  buildOpts: BunBuildOpts,
  deps: CompilerDeps,
): Result<void, PaihError> {
  const { entryPath, outfile, mode, sourceRoot } = buildOpts;

  // --define to prevent process.env inlining at build time
  const defineFlag = '--define "process.env=process.env"';
  const bundleFlags = "--bundle --format=esm";

  let cmd: string;
  if (mode === "compiled") {
    // Node target: substitute stdin adapter with node-stdin-shim
    const shimPath = `${sourceRoot}/cli/core/node-stdin-shim.ts`;
    const aliasFlag = `--alias "@hooks/core/adapters/stdin"="${shimPath}"`;
    cmd = `bun build ${entryPath} --target=node ${bundleFlags} ${aliasFlag} ${defineFlag} --outfile=${outfile}`;
  } else {
    // Bun target: no substitution needed
    cmd = `bun build ${entryPath} ${bundleFlags} ${defineFlag} --outfile=${outfile}`;
  }

  const execResult = deps.exec(cmd, { cwd: sourceRoot });
  if (!execResult.ok) {
    return err(buildFailed(`bun build failed: ${execResult.error.message}`));
  }

  if (execResult.value.exitCode !== 0) {
    const stderr = execResult.value.stderr.trim();
    return err(buildFailed(`bun build exited with code ${execResult.value.exitCode}: ${stderr}`));
  }

  return ok(undefined);
}
