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

import { describe, expect, it } from "bun:test";
import type { ExecResult } from "@hooks/cli/adapters/process";
import type { CompileHookOpts, CompilerDeps } from "@hooks/cli/core/compiler";
import { compiledCommandString, compileHook } from "@hooks/cli/core/compiler";
import type { PaihError } from "@hooks/cli/core/error";
import { PaihErrorCode } from "@hooks/cli/core/error";
import type { Result } from "@hooks/cli/core/result";
import { err, ok } from "@hooks/cli/core/result";
import { InMemoryDeps } from "@hooks/cli/types/deps";

// ─── Test Helpers ───────────────────────────────────────────────────────────

/**
 * Build a CompilerDeps from InMemoryDeps with exec stub.
 *
 * The exec stub simulates bun build by writing a fake bundle to the --outfile path,
 * and records all exec commands for assertion.
 */
function makeCompilerDeps(
  fileTree: Record<string, string>,
  cwd = "/source",
): { deps: CompilerDeps; execCmds: string[] } {
  const memDeps = new InMemoryDeps(fileTree, cwd);
  const execCmds: string[] = [];

  const deps: CompilerDeps = {
    readFile: (p) => memDeps.readFile(p),
    writeFile: (p, c) => memDeps.writeFile(p, c),
    fileExists: (p) => memDeps.fileExists(p),
    readDir: (p) => memDeps.readDir(p),
    ensureDir: (p) => memDeps.ensureDir(p),
    stat: (p) => memDeps.stat(p),
    cwd: () => memDeps.cwd(),
    exec: (cmd: string): Result<ExecResult, PaihError> => {
      execCmds.push(cmd);
      // Simulate bun build: extract --outfile path and write fake output
      const outfileMatch = cmd.match(/--outfile[= ](\S+)/);
      if (outfileMatch) {
        const outfile = outfileMatch[1];
        memDeps.writeFile(outfile, "// compiled output\nconsole.log('hello');\n");
      }
      return ok({ stdout: "", stderr: "", exitCode: 0 });
    },
    deleteFile: (p: string): Result<void, PaihError> => {
      memDeps.deleteFile(p);
      return ok(undefined);
    },
    removeDir: (_p: string): Result<void, PaihError> => ok(undefined),
    chmod: (_p: string, _m: number): Result<void, PaihError> => ok(undefined),
  };

  return { deps, execCmds };
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
    const { deps } = makeCompilerDeps({
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

  it("runs chmod 755 on output file via exec", () => {
    const { deps, execCmds } = makeCompilerDeps({
      "/source/hooks/GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.hook.ts": "// hook",
    });

    const result = compileHook(makeOpts({ mode: "compiled" }), deps);
    expect(result.ok).toBe(true);

    const chmodCmd = execCmds.find((c) => c.startsWith("chmod"));
    expect(chmodCmd).toBeDefined();
    expect(chmodCmd).toContain("755");
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
    const memDeps = new InMemoryDeps(
      {
        "/source/hooks/GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.hook.ts": "// hook",
      },
      "/source",
    );

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
      deleteFile: () => ok(undefined),
      removeDir: () => ok(undefined),
      chmod: () => ok(undefined),
    };

    const result = compileHook(makeOpts({ mode: "compiled" }), deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PaihErrorCode.BuildFailed);
      expect(result.error.message).toContain("module not found");
    }
  });

  it("compiled mode passes --target=node to bun build", () => {
    const { deps, execCmds } = makeCompilerDeps({
      "/source/hooks/GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.hook.ts": "// hook",
    });

    compileHook(makeOpts({ mode: "compiled" }), deps);
    const buildCmd = execCmds.find((c) => c.startsWith("bun build"));
    expect(buildCmd).toContain("--target=node");
    expect(buildCmd).toContain("--tsconfig-override");
  });

  it("compiled-ts mode does NOT pass --target=node", () => {
    const { deps, execCmds } = makeCompilerDeps({
      "/source/hooks/GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.hook.ts": "// hook",
    });

    compileHook(makeOpts({ mode: "compiled-ts" }), deps);
    const buildCmd = execCmds.find((c) => c.startsWith("bun build"));
    expect(buildCmd).not.toContain("--target=node");
  });

  it("passes process.env define to prevent inlining", () => {
    const { deps, execCmds } = makeCompilerDeps({
      "/source/hooks/GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.hook.ts": "// hook",
    });

    compileHook(makeOpts({ mode: "compiled" }), deps);
    const buildCmd = execCmds.find((c) => c.startsWith("bun build"));
    expect(buildCmd).toContain("process.env=process.env");
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

// ─── Error branches ────────────────────────────────────────────────────────

describe("compileHook error paths", () => {
  const hookFile = "/source/hooks/G/H/H.hook.ts";
  const baseTree = { [hookFile]: "// hook" };
  const opts = makeOpts({ hookPath: hookFile, outputName: "H" });

  it("returns error when reading build output fails", () => {
    const { deps } = makeCompilerDeps(baseTree);
    // Override readFile to fail on the .tmp output
    const origReadFile = deps.readFile;
    deps.readFile = (p: string) => {
      if (p.endsWith(".tmp")) {
        return err(new (class extends Error { code = PaihErrorCode.BuildFailed; constructor() { super("read fail"); } })() as unknown as PaihError);
      }
      return origReadFile(p);
    };
    const result = compileHook(opts, deps);
    expect(result.ok).toBe(false);
  });

  it("returns error when writing final output fails", () => {
    const { deps } = makeCompilerDeps(baseTree);
    const origWriteFile = deps.writeFile;
    deps.writeFile = (p: string, c: string) => {
      // Let tsconfig and temp bundle writes succeed, fail on final .js write
      if (p.endsWith(".js") && !p.endsWith(".tmp")) {
        return err(new (class extends Error { code = PaihErrorCode.BuildFailed; constructor() { super("write fail"); } })() as unknown as PaihError);
      }
      return origWriteFile(p, c);
    };
    const result = compileHook(opts, deps);
    expect(result.ok).toBe(false);
  });

  it("returns error when tsconfig write fails in compiled mode", () => {
    const { deps } = makeCompilerDeps(baseTree);
    const origWriteFile = deps.writeFile;
    deps.writeFile = (p: string, c: string) => {
      if (p.endsWith(".tsconfig.json")) {
        return err(new (class extends Error { code = PaihErrorCode.BuildFailed; constructor() { super("tsconfig write fail"); } })() as unknown as PaihError);
      }
      return origWriteFile(p, c);
    };
    const result = compileHook(opts, deps);
    expect(result.ok).toBe(false);
  });

  it("returns error when chmod fails", () => {
    const { deps } = makeCompilerDeps(baseTree);
    deps.exec = (cmd: string): Result<ExecResult, PaihError> => {
      // Let bun build succeed but chmod fail
      const outfileMatch = cmd.match(/--outfile[= ](\S+)/);
      if (outfileMatch) {
        deps.writeFile(outfileMatch[1], "// compiled\n");
        return ok({ stdout: "", stderr: "", exitCode: 0 });
      }
      if (cmd.includes("chmod")) {
        return err(new (class extends Error { code = PaihErrorCode.BuildFailed; constructor() { super("chmod fail"); } })() as unknown as PaihError);
      }
      return ok({ stdout: "", stderr: "", exitCode: 0 });
    };
    const result = compileHook(opts, deps);
    expect(result.ok).toBe(false);
  });
});
