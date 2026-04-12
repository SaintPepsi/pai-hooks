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

import type { PaihError } from "@hooks/cli/core/error";
import { buildFailed } from "@hooks/cli/core/error";
import type { Result } from "@hooks/cli/core/result";
import { err, ok } from "@hooks/cli/core/result";
import type { CliDeps } from "@hooks/cli/types/deps";
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

/** CompilerDeps is CliDeps — no additional methods needed. */
export type CompilerDeps = CliDeps;

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

  // Step 1: Run bun build to temp file
  const buildResult = runBunBuild(
    { entryPath: hookPath, outfile: tempPath, mode, sourceRoot },
    deps,
  );
  if (!buildResult.ok) return buildResult;

  // Step 2: Read the temp output
  const readResult = deps.readFile(tempPath);
  if (!readResult.ok) {
    return err(buildFailed(`Failed to read build output at ${tempPath}`));
  }

  // Step 3: Write final file with shebang prepended (strip any existing shebang from build output)
  const buildOutput = readResult.value.replace(/^#!.*\n/, "");
  const withShebang = `${shebang}\n${buildOutput}`;
  const writeResult = deps.writeFile(finalPath, withShebang);
  if (!writeResult.ok) {
    return err(buildFailed(`Failed to write compiled output at ${finalPath}`));
  }

  // Step 4: Clean up temp file
  if (deps.fileExists(tempPath)) {
    deps.deleteFile(tempPath);
  }

  // Step 5: chmod 0o755
  const chmodResult = deps.exec(`chmod ${EXECUTABLE_MODE.toString(8)} ${finalPath}`);
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
 * --compiled:    direct path format (relies on shebang), e.g. "$CLAUDE_PROJECT_DIR/.claude/hooks/Group/Hook.js"
 * --compiled-ts: bun <path> format, e.g. "bun $CLAUDE_PROJECT_DIR/.claude/hooks/Group/Hook.ts"
 */
export function compiledCommandString(hookPath: string, mode: OutputMode): string {
  if (mode === "compiled-ts") {
    return `bun ${hookPath}`;
  }
  // "compiled" mode uses direct path format (relies on shebang)
  return hookPath;
}

// ─── Internal ───────────────────────────────────────────────────────────────

/** Build command arguments derived from CompileHookOpts. */
interface BunBuildOpts {
  entryPath: string;
  outfile: string;
  mode: OutputMode;
  sourceRoot: string;
}

function runBunBuild(buildOpts: BunBuildOpts, deps: CompilerDeps): Result<void, PaihError> {
  const { entryPath, outfile, mode, sourceRoot } = buildOpts;

  // --define to prevent process.env inlining at build time
  const defineFlag = '--define "process.env=process.env"';
  const bundleFlags = "--bundle --format=esm";

  let cmd: string;
  if (mode === "compiled") {
    // Node target: use a temporary tsconfig that redirects core/adapters/stdin
    // to the Node-compatible shim. The --alias flag is broken in bun build
    // (causes "multiple entry points" error), so we use --tsconfig-override instead.
    const shimPath = `${sourceRoot}/cli/core/node-stdin-shim.ts`;
    const tsconfigOverride = JSON.stringify({
      extends: `${sourceRoot}/tsconfig.json`,
      compilerOptions: {
        baseUrl: sourceRoot,
        paths: {
          "@hooks/*": ["./*"],
          "@hooks/core/adapters/stdin": [shimPath],
        },
      },
    });
    const tsconfigPath = `${outfile}.tsconfig.json`;
    const writeResult = deps.writeFile(tsconfigPath, tsconfigOverride);
    if (!writeResult.ok) {
      return err(buildFailed(`Failed to write temp tsconfig: ${writeResult.error.message}`));
    }
    cmd = `bun build ${entryPath} --target=node ${bundleFlags} --tsconfig-override ${tsconfigPath} ${defineFlag} --outfile=${outfile}`;
  } else {
    // Bun target: source repo tsconfig resolves @hooks/* automatically
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

  // Clean up temp tsconfig if created
  if (mode === "compiled") {
    const tsconfigPath = `${outfile}.tsconfig.json`;
    if (deps.fileExists(tsconfigPath)) {
      deps.deleteFile(tsconfigPath);
    }
  }

  return ok(undefined);
}
