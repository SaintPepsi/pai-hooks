/**
 * Compiled install integration tests — end-to-end for --compiled and --compiled-ts modes.
 *
 * Tests the full install pipeline with compiled output modes, including
 * mode change detection, command string formatting, and lockfile recording.
 *
 * Install pipeline under test:
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-ac7f9ecc/cli/commands/install.ts).
 * Compiler:
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-ac7f9ecc/cli/core/compiler.ts).
 * Lockfile types:
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-ac7f9ecc/cli/types/lockfile.ts).
 */

import { describe, it, expect } from "bun:test";
import { install } from "@hooks/cli/commands/install";
import type { ParsedArgs } from "@hooks/cli/core/args";
import type { CompilerDeps } from "@hooks/cli/core/compiler";
import type { ExecResult } from "@hooks/cli/adapters/process";
import type { Result } from "@hooks/cli/core/result";
import { ok } from "@hooks/cli/core/result";
import type { PaihError } from "@hooks/cli/core/error";
import { PaihErrorCode } from "@hooks/cli/core/error";
import { InMemoryDeps } from "@hooks/cli/types/deps";
import type { SettingsJson } from "@hooks/cli/core/settings";
import type { Lockfile } from "@hooks/cli/types/lockfile";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeSourceRepo(): Record<string, string> {
  return {
    "/source/hooks/CodingStandards/group.json": JSON.stringify({
      name: "CodingStandards",
      description: "TypeScript quality enforcement hooks",
      hooks: ["TypeStrictness"],
      sharedFiles: [],
    }),
    "/source/hooks/CodingStandards/TypeStrictness/hook.json": JSON.stringify({
      name: "TypeStrictness",
      group: "CodingStandards",
      event: "PreToolUse",
      description: "Enforces strict TypeScript",
      schemaVersion: 1,
      deps: { core: ["result"], lib: [], adapters: [], shared: false },
      tags: [],
      presets: ["quality"],
    }),
    "/source/hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts":
      '// TypeStrictness hook\nexport default {};\n',
    "/source/hooks/CodingStandards/TypeStrictness/TypeStrictness.contract.ts":
      '// TypeStrictness contract\nexport default {};\n',
    "/source/core/result.ts":
      '// core result module\nexport const ok = true;\n',
    "/source/presets.json": JSON.stringify({
      quality: { description: "Code quality", groups: ["CodingStandards"] },
    }),
    "/project/.claude/settings.json": "{}",
  };
}

function makeCompilerDeps(fileTree: Record<string, string>): CompilerDeps {
  const memDeps = new InMemoryDeps(fileTree, "/source");

  return {
    readFile: (p) => memDeps.readFile(p),
    writeFile: (p, c) => memDeps.writeFile(p, c),
    fileExists: (p) => memDeps.fileExists(p),
    readDir: (p) => memDeps.readDir(p),
    ensureDir: (p) => memDeps.ensureDir(p),
    stat: (p) => memDeps.stat(p),
    cwd: () => memDeps.cwd(),
    getFiles: () => memDeps.getFiles(),
    exec: (cmd: string): Result<ExecResult, PaihError> => {
      const outfileMatch = cmd.match(/--outfile=(\S+)/);
      if (outfileMatch) {
        memDeps.writeFile(outfileMatch[1], "// compiled bundle\nconsole.log('hook');\n");
      }
      return ok({ stdout: "", stderr: "", exitCode: 0 });
    },
    chmod: (): Result<void, PaihError> => ok(undefined),
    rename: (src: string, dest: string): Result<void, PaihError> => {
      const content = memDeps.readFile(src);
      if (content.ok) memDeps.writeFile(dest, content.value);
      return ok(undefined);
    },
    deleteFile: (): Result<void, PaihError> => ok(undefined),
    removeDir: (): Result<void, PaihError> => ok(undefined),
  } as CompilerDeps & { getFiles: () => Map<string, string> };
}

function makeArgs(
  names: string[],
  flags: Record<string, boolean | string> = {},
): ParsedArgs {
  return { command: "install", names, flags: { to: "/project", ...flags } };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("install --compiled", () => {
  it("produces .js file and records compiled mode in lockfile", () => {
    const deps = makeCompilerDeps(makeSourceRepo());
    const result = install(makeArgs(["TypeStrictness"], { compiled: true }), deps, "/source");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const files = (deps as CompilerDeps & { getFiles: () => Map<string, string> }).getFiles();

    // Lockfile records compiled mode
    const lockContent = files.get("/project/.claude/hooks/paih.lock.json")!;
    const lock: Lockfile = JSON.parse(lockContent);
    expect(lock.outputMode).toBe("compiled");

    // Settings uses direct path format (relies on shebang)
    const settingsContent = files.get("/project/.claude/settings.json")!;
    const settings: SettingsJson = JSON.parse(settingsContent);
    const commands = settings.hooks?.PreToolUse?.flatMap((g) => g.hooks.map((h) => h.command)) ?? [];
    expect(commands.some((c) => c.endsWith(".js"))).toBe(true);
    expect(commands.some((c) => c.startsWith("bun "))).toBe(false);
  });
});

describe("install --compiled-ts", () => {
  it("records compiled-ts mode and uses bun <path> command format", () => {
    const deps = makeCompilerDeps(makeSourceRepo());
    const result = install(makeArgs(["TypeStrictness"], { compiledTs: true }), deps, "/source");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const files = (deps as CompilerDeps & { getFiles: () => Map<string, string> }).getFiles();

    const lockContent = files.get("/project/.claude/hooks/paih.lock.json")!;
    const lock: Lockfile = JSON.parse(lockContent);
    expect(lock.outputMode).toBe("compiled-ts");

    const settingsContent = files.get("/project/.claude/settings.json")!;
    const settings: SettingsJson = JSON.parse(settingsContent);
    const commands = settings.hooks?.PreToolUse?.flatMap((g) => g.hooks.map((h) => h.command)) ?? [];
    expect(commands.some((c) => c.startsWith("bun "))).toBe(true);
  });
});

describe("mode change detection", () => {
  it("rejects mode change without --force", () => {
    const deps = makeCompilerDeps({
      ...makeSourceRepo(),
      "/project/.claude/hooks/paih.lock.json": JSON.stringify({
        lockfileVersion: 1,
        source: "/source",
        sourceCommit: null,
        installedAt: "2025-01-01T00:00:00Z",
        outputMode: "source",
        hooks: [],
      }),
    });

    const result = install(
      makeArgs(["TypeStrictness"], { compiled: true }),
      deps,
      "/source",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PaihErrorCode.InvalidArgs);
      expect(result.error.message).toContain("--force");
    }
  });

  it("allows mode change with --force", () => {
    const deps = makeCompilerDeps({
      ...makeSourceRepo(),
      "/project/.claude/hooks/paih.lock.json": JSON.stringify({
        lockfileVersion: 1,
        source: "/source",
        sourceCommit: null,
        installedAt: "2025-01-01T00:00:00Z",
        outputMode: "source",
        hooks: [],
      }),
    });

    const result = install(
      makeArgs(["TypeStrictness"], { compiled: true, force: true }),
      deps,
      "/source",
    );

    expect(result.ok).toBe(true);
  });

  it("allows same mode without --force", () => {
    const deps = makeCompilerDeps({
      ...makeSourceRepo(),
      "/project/.claude/hooks/paih.lock.json": JSON.stringify({
        lockfileVersion: 1,
        source: "/source",
        sourceCommit: null,
        installedAt: "2025-01-01T00:00:00Z",
        outputMode: "compiled",
        hooks: [],
      }),
    });

    const result = install(
      makeArgs(["TypeStrictness"], { compiled: true }),
      deps,
      "/source",
    );

    expect(result.ok).toBe(true);
  });
});

describe("lockfile backward compatibility", () => {
  it("old lockfile without outputMode defaults to source", () => {
    const deps = makeCompilerDeps({
      ...makeSourceRepo(),
      "/project/.claude/hooks/paih.lock.json": JSON.stringify({
        lockfileVersion: 1,
        source: "/source",
        sourceCommit: null,
        installedAt: "2025-01-01T00:00:00Z",
        hooks: [],
      }),
    });

    // Install in source mode should succeed (same as default)
    const result = install(
      makeArgs(["TypeStrictness"]),
      deps,
      "/source",
    );

    expect(result.ok).toBe(true);
  });

  it("old lockfile without outputMode requires --force for compiled mode", () => {
    const deps = makeCompilerDeps({
      ...makeSourceRepo(),
      "/project/.claude/hooks/paih.lock.json": JSON.stringify({
        lockfileVersion: 1,
        source: "/source",
        sourceCommit: null,
        installedAt: "2025-01-01T00:00:00Z",
        hooks: [],
      }),
    });

    const result = install(
      makeArgs(["TypeStrictness"], { compiled: true }),
      deps,
      "/source",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("--force");
    }
  });
});

describe("install source mode unchanged", () => {
  it("source mode still works as before", () => {
    const memDeps = new InMemoryDeps(makeSourceRepo(), "/source");
    const result = install(makeArgs(["TypeStrictness"]), memDeps, "/source");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const files = memDeps.getFiles();
    expect(files.has("/project/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts")).toBe(true);

    const lockContent = files.get("/project/.claude/hooks/paih.lock.json")!;
    const lock: Lockfile = JSON.parse(lockContent);
    expect(lock.outputMode).toBe("source");
  });
});
