/**
 * Compiler tests — unit tests for compileHook and compiledCommandString.
 *
 * Uses InMemoryDeps extended with CompilerDeps stubs for exec, chmod, rename.
 * Tests both --compiled (Node) and --compiled-ts (Bun) output modes.
 *
 * Compiler module under test:
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-ac7f9ecc/cli/core/compiler.ts).
 * InMemoryDeps:
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-ac7f9ecc/cli/types/deps.ts).
 */

import { describe, it, expect } from "bun:test";
import { compileHook, compiledCommandString } from "@hooks/cli/core/compiler";
import type { CompilerDeps, CompileHookOpts } from "@hooks/cli/core/compiler";
import type { ExecResult } from "@hooks/cli/adapters/process";
import type { Result } from "@hooks/cli/core/result";
import { ok } from "@hooks/cli/core/result";
import type { PaihError } from "@hooks/cli/core/error";
import { PaihErrorCode } from "@hooks/cli/core/error";
import { InMemoryDeps } from "@hooks/cli/types/deps";

// ─── Test Helpers ───────────────────────────────────────────────────────────

/** Track chmod calls for assertions. */
interface ChmodCall {
  path: string;
  mode: number;
}

/** Track rename calls for assertions. */
interface RenameCall {
  src: string;
  dest: string;
}

/**
 * Build a CompilerDeps from InMemoryDeps, adding exec/chmod/rename stubs.
 *
 * The exec stub simulates bun build by writing a fake bundle to the --outfile path.
 */
function makeCompilerDeps(
  fileTree: Record<string, string>,
  cwd = "/source",
): { deps: CompilerDeps; chmodCalls: ChmodCall[]; renameCalls: RenameCall[] } {
  const memDeps = new InMemoryDeps(fileTree, cwd);
  const chmodCalls: ChmodCall[] = [];
  const renameCalls: RenameCall[] = [];

  const deps: CompilerDeps = {
    readFile: (p) => memDeps.readFile(p),
    writeFile: (p, c) => memDeps.writeFile(p, c),
    fileExists: (p) => memDeps.fileExists(p),
    readDir: (p) => memDeps.readDir(p),
    ensureDir: (p) => memDeps.ensureDir(p),
    stat: (p) => memDeps.stat(p),
    cwd: () => memDeps.cwd(),
    exec: (cmd: string): Result<ExecResult, PaihError> => {
      // Simulate bun build: extract --outfile path and write fake output
      const outfileMatch = cmd.match(/--outfile=(\S+)/);
      if (outfileMatch) {
        const outfile = outfileMatch[1];
        memDeps.writeFile(outfile, "// compiled output\nconsole.log('hello');\n");
      }
      return ok({ stdout: "", stderr: "", exitCode: 0 });
    },
    chmod: (path: string, mode: number): Result<void, PaihError> => {
      chmodCalls.push({ path, mode });
      return ok(undefined);
    },
    rename: (src: string, dest: string): Result<void, PaihError> => {
      const content = memDeps.readFile(src);
      if (!content.ok) return content;
      memDeps.writeFile(dest, content.value);
      renameCalls.push({ src, dest });
      return ok(undefined);
    },
  };

  return { deps, chmodCalls, renameCalls };
}

function makeOpts(overrides: Partial<CompileHookOpts> = {}): CompileHookOpts {
  return {
    hookPath: "/source/hooks/GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.hook.ts",
    mode: "compiled",
    outputDir: "/target/.claude/hooks/GitSafety/DestructiveDeleteGuard",
    outputName: "DestructiveDeleteGuard",
    sourceRoot: "/source",
    ...overrides,
  };
}

// ─── compileHook Tests ──────────────────────────────────────────────────────

describe("compileHook", () => {
  it("compiled mode — produces .js with node shebang", () => {
    const { deps, chmodCalls, renameCalls } = makeCompilerDeps({
      "/source/hooks/GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.hook.ts": "// hook",
    });

    const result = compileHook(makeOpts({ mode: "compiled" }), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.outputPath).toEndWith(".js");
    expect(result.value.shebang).toBe("#!/usr/bin/env node");
    expect(result.value.outputMode).toBe("compiled");
    expect(result.value.size).toBeGreaterThan(0);
  });

  it("compiled-ts mode — produces .ts with bun shebang", () => {
    const { deps } = makeCompilerDeps({
      "/source/hooks/GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.hook.ts": "// hook",
    });

    const result = compileHook(makeOpts({ mode: "compiled-ts" }), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.outputPath).toEndWith(".ts");
    expect(result.value.shebang).toBe("#!/usr/bin/env bun");
    expect(result.value.outputMode).toBe("compiled-ts");
  });

  it("sets chmod 0o755 on output file", () => {
    const { deps, chmodCalls } = makeCompilerDeps({
      "/source/hooks/GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.hook.ts": "// hook",
    });

    const result = compileHook(makeOpts({ mode: "compiled" }), deps);
    expect(result.ok).toBe(true);

    expect(chmodCalls).toHaveLength(1);
    expect(chmodCalls[0].mode).toBe(0o755);
  });

  it("uses atomic rename (temp → final)", () => {
    const { deps, renameCalls } = makeCompilerDeps({
      "/source/hooks/GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.hook.ts": "// hook",
    });

    const result = compileHook(makeOpts({ mode: "compiled" }), deps);
    expect(result.ok).toBe(true);

    expect(renameCalls).toHaveLength(1);
    expect(renameCalls[0].dest).toEndWith(".js");
    expect(renameCalls[0].src).toContain(".tmp");
  });

  it("output file starts with shebang line", () => {
    const { deps } = makeCompilerDeps({
      "/source/hooks/GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.hook.ts": "// hook",
    });

    const result = compileHook(makeOpts({ mode: "compiled" }), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Read the final file via the rename dest
    const finalContent = deps.readFile(result.value.outputPath);
    expect(finalContent.ok).toBe(true);
    if (finalContent.ok) {
      expect(finalContent.value.startsWith("#!/usr/bin/env node\n")).toBe(true);
    }
  });

  it("returns BUILD_FAILED when mode is source", () => {
    const { deps } = makeCompilerDeps({});

    const result = compileHook(makeOpts({ mode: "source" }), deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PaihErrorCode.BuildFailed);
    }
  });

  it("returns BUILD_FAILED when bun build exits non-zero", () => {
    const memDeps = new InMemoryDeps({
      "/source/hooks/GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.hook.ts": "// hook",
    }, "/source");

    const deps: CompilerDeps = {
      readFile: (p) => memDeps.readFile(p),
      writeFile: (p, c) => memDeps.writeFile(p, c),
      fileExists: (p) => memDeps.fileExists(p),
      readDir: (p) => memDeps.readDir(p),
      ensureDir: (p) => memDeps.ensureDir(p),
      stat: (p) => memDeps.stat(p),
      cwd: () => memDeps.cwd(),
      exec: (): Result<ExecResult, PaihError> => {
        return ok({ stdout: "", stderr: "error: module not found", exitCode: 1 });
      },
      chmod: () => ok(undefined),
      rename: () => ok(undefined),
    };

    const result = compileHook(makeOpts({ mode: "compiled" }), deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PaihErrorCode.BuildFailed);
      expect(result.error.message).toContain("module not found");
    }
  });

  it("compiled mode passes --target=node to bun build", () => {
    let capturedCmd = "";
    const memDeps = new InMemoryDeps({
      "/source/hooks/GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.hook.ts": "// hook",
    }, "/source");

    const deps: CompilerDeps = {
      readFile: (p) => memDeps.readFile(p),
      writeFile: (p, c) => memDeps.writeFile(p, c),
      fileExists: (p) => memDeps.fileExists(p),
      readDir: (p) => memDeps.readDir(p),
      ensureDir: (p) => memDeps.ensureDir(p),
      stat: (p) => memDeps.stat(p),
      cwd: () => memDeps.cwd(),
      exec: (cmd: string): Result<ExecResult, PaihError> => {
        capturedCmd = cmd;
        const outfileMatch = cmd.match(/--outfile=(\S+)/);
        if (outfileMatch) {
          memDeps.writeFile(outfileMatch[1], "// output");
        }
        return ok({ stdout: "", stderr: "", exitCode: 0 });
      },
      chmod: () => ok(undefined),
      rename: (src, dest) => {
        const c = memDeps.readFile(src);
        if (c.ok) memDeps.writeFile(dest, c.value);
        return ok(undefined);
      },
    };

    compileHook(makeOpts({ mode: "compiled" }), deps);
    expect(capturedCmd).toContain("--target=node");
    expect(capturedCmd).toContain("--alias");
  });

  it("compiled-ts mode does NOT pass --target=node", () => {
    let capturedCmd = "";
    const memDeps = new InMemoryDeps({
      "/source/hooks/GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.hook.ts": "// hook",
    }, "/source");

    const deps: CompilerDeps = {
      readFile: (p) => memDeps.readFile(p),
      writeFile: (p, c) => memDeps.writeFile(p, c),
      fileExists: (p) => memDeps.fileExists(p),
      readDir: (p) => memDeps.readDir(p),
      ensureDir: (p) => memDeps.ensureDir(p),
      stat: (p) => memDeps.stat(p),
      cwd: () => memDeps.cwd(),
      exec: (cmd: string): Result<ExecResult, PaihError> => {
        capturedCmd = cmd;
        const outfileMatch = cmd.match(/--outfile=(\S+)/);
        if (outfileMatch) {
          memDeps.writeFile(outfileMatch[1], "// output");
        }
        return ok({ stdout: "", stderr: "", exitCode: 0 });
      },
      chmod: () => ok(undefined),
      rename: (src, dest) => {
        const c = memDeps.readFile(src);
        if (c.ok) memDeps.writeFile(dest, c.value);
        return ok(undefined);
      },
    };

    compileHook(makeOpts({ mode: "compiled-ts" }), deps);
    expect(capturedCmd).not.toContain("--target=node");
  });

  it("passes process.env define to prevent inlining", () => {
    let capturedCmd = "";
    const memDeps = new InMemoryDeps({
      "/source/hooks/GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.hook.ts": "// hook",
    }, "/source");

    const deps: CompilerDeps = {
      readFile: (p) => memDeps.readFile(p),
      writeFile: (p, c) => memDeps.writeFile(p, c),
      fileExists: (p) => memDeps.fileExists(p),
      readDir: (p) => memDeps.readDir(p),
      ensureDir: (p) => memDeps.ensureDir(p),
      stat: (p) => memDeps.stat(p),
      cwd: () => memDeps.cwd(),
      exec: (cmd: string): Result<ExecResult, PaihError> => {
        capturedCmd = cmd;
        const outfileMatch = cmd.match(/--outfile=(\S+)/);
        if (outfileMatch) {
          memDeps.writeFile(outfileMatch[1], "// output");
        }
        return ok({ stdout: "", stderr: "", exitCode: 0 });
      },
      chmod: () => ok(undefined),
      rename: (src, dest) => {
        const c = memDeps.readFile(src);
        if (c.ok) memDeps.writeFile(dest, c.value);
        return ok(undefined);
      },
    };

    compileHook(makeOpts({ mode: "compiled" }), deps);
    expect(capturedCmd).toContain("process.env=process.env");
  });
});

// ─── compiledCommandString Tests ────────────────────────────────────────────

describe("compiledCommandString", () => {
  it("compiled mode — returns direct path", () => {
    const result = compiledCommandString("./hooks/Group/Hook.js", "compiled");
    expect(result).toBe("./hooks/Group/Hook.js");
  });

  it("compiled-ts mode — returns bun <path>", () => {
    const result = compiledCommandString("./hooks/Group/Hook.ts", "compiled-ts");
    expect(result).toBe("bun ./hooks/Group/Hook.ts");
  });

  it("source mode — returns direct path", () => {
    const result = compiledCommandString("./hooks/Group/Hook.hook.ts", "source");
    expect(result).toBe("./hooks/Group/Hook.hook.ts");
  });
});
