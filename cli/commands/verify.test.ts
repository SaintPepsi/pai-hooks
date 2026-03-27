/**
 * Verify command tests — source-mode and installed-mode validation.
 *
 * Source mode: validates hook.json manifests match actual imports.
 * Installed mode: checks installed files match lockfile hashes.
 *
 * Uses InMemoryDeps from cli/types/deps.ts.
 * Tests the verify function from cli/commands/verify.ts.
 */

import { describe, it, expect } from "bun:test";
import { verify } from "@hooks/cli/commands/verify";
import { install } from "@hooks/cli/commands/install";
import type { ParsedArgs } from "@hooks/cli/core/args";
import { InMemoryDeps } from "@hooks/cli/types/deps";
import { PaihErrorCode } from "@hooks/cli/core/error";

// ─── Fixtures ───────────────────────────────────────────────────────────────

/** Source repo with a hook whose manifest matches its imports. */
function makeCleanSourceRepo(): Record<string, string> {
  return {
    "/source/hooks/TestGroup/group.json": JSON.stringify({
      name: "TestGroup",
      description: "Test hooks",
      hooks: ["TestHook"],
      sharedFiles: [],
    }),
    "/source/hooks/TestGroup/TestHook/hook.json": JSON.stringify({
      name: "TestHook",
      group: "TestGroup",
      event: "PreToolUse",
      description: "A test hook",
      schemaVersion: 1,
      deps: { core: ["result"], lib: [], adapters: ["fs"], shared: false },
      tags: [],
      presets: [],
    }),
    "/source/hooks/TestGroup/TestHook/TestHook.hook.ts": [
      'import { ok } from "@hooks/core/result";',
      'import { readFile } from "@hooks/core/adapters/fs";',
      "export default {};",
    ].join("\n"),
    "/source/hooks/TestGroup/TestHook/TestHook.contract.ts":
      "export default {};",
    "/source/core/result.ts": "export const ok = true;",
    "/source/presets.json": "{}",
  };
}

/** Source repo where manifest is missing a dep that the contract imports. */
function makeMissingDepRepo(): Record<string, string> {
  return {
    ...makeCleanSourceRepo(),
    // Manifest declares core: ["result"] but contract also imports adapters/fs
    "/source/hooks/TestGroup/TestHook/hook.json": JSON.stringify({
      name: "TestHook",
      group: "TestGroup",
      event: "PreToolUse",
      description: "A test hook",
      schemaVersion: 1,
      deps: { core: ["result"], lib: [], adapters: [], shared: false },
      tags: [],
      presets: [],
    }),
  };
}

/** Source repo where manifest declares a dep the contract does not import. */
function makeGhostDepRepo(): Record<string, string> {
  return {
    ...makeCleanSourceRepo(),
    "/source/hooks/TestGroup/TestHook/hook.json": JSON.stringify({
      name: "TestHook",
      group: "TestGroup",
      event: "PreToolUse",
      description: "A test hook",
      schemaVersion: 1,
      deps: { core: ["result", "error"], lib: [], adapters: ["fs"], shared: false },
      tags: [],
      presets: [],
    }),
  };
}

function makeInstalledProject(): Record<string, string> {
  return {
    ...makeCleanSourceRepo(),
    "/project/.claude/settings.json": "{}",
  };
}

function sourceVerifyArgs(flags: Record<string, boolean | string> = {}): ParsedArgs {
  return { command: "verify", names: [], flags };
}

function installedVerifyArgs(flags: Record<string, boolean | string> = {}): ParsedArgs {
  return { command: "verify", names: [], flags: { installed: true, ...flags } };
}

function installArgs(names: string[]): ParsedArgs {
  return { command: "install", names, flags: { to: "/project" } };
}

// ─── Source Mode Tests ──────────────────────────────────────────────────────

describe("verify source-mode", () => {
  it("clean hook passes", () => {
    const deps = new InMemoryDeps(makeCleanSourceRepo(), "/source");
    const result = verify(sourceVerifyArgs(), deps, "/source");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("All hook manifests are valid");
    }
  });

  it("missing dep reported", () => {
    const deps = new InMemoryDeps(makeMissingDepRepo(), "/source");
    const result = verify(sourceVerifyArgs(), deps, "/source");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("MANIFEST_MISSING_DEP");
      expect(result.value).toContain("adapters/fs");
    }
  });

  it("ghost dep reported", () => {
    const deps = new InMemoryDeps(makeGhostDepRepo(), "/source");
    const result = verify(sourceVerifyArgs(), deps, "/source");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("MANIFEST_GHOST_DEP");
      expect(result.value).toContain("core/error");
    }
  });

  it("--fix rewrites manifest to match actual imports", () => {
    const deps = new InMemoryDeps(makeMissingDepRepo(), "/source");
    const result = verify(sourceVerifyArgs({ fix: true }), deps, "/source");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("Fixed 1 hook manifest");
    }

    // Verify the manifest was rewritten
    const manifestContent = deps.getFiles().get("/source/hooks/TestGroup/TestHook/hook.json")!;
    const manifest = JSON.parse(manifestContent);
    expect(manifest.deps.adapters).toContain("fs");
  });

  it("no hooks/ directory → nothing to verify", () => {
    const deps = new InMemoryDeps({}, "/empty");
    const result = verify(sourceVerifyArgs(), deps, "/empty");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("No hooks/ directory found");
    }
  });
});

// ─── Installed Mode Tests ───────────────────────────────────────────────────

describe("verify installed-mode", () => {
  it("clean install passes", () => {
    const deps = new InMemoryDeps(makeInstalledProject(), "/source");
    install(installArgs(["TestHook"]), deps, "/source");

    const result = verify(installedVerifyArgs({ in: "/project" }), deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("No drift detected");
    }
  });

  it("modified file reported", () => {
    const deps = new InMemoryDeps(makeInstalledProject(), "/source");
    install(installArgs(["TestHook"]), deps, "/source");

    // Modify an installed file
    deps.addFile(
      "/project/.claude/hooks/pai-hooks/TestGroup/TestHook/TestHook.hook.ts",
      "// MODIFIED\n",
    );

    const result = verify(installedVerifyArgs({ in: "/project" }), deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("FILE_MODIFIED");
    }
  });

  it("missing file reported", () => {
    const deps = new InMemoryDeps(makeInstalledProject(), "/source");
    install(installArgs(["TestHook"]), deps, "/source");

    // Delete an installed file
    deps.deleteFile("/project/.claude/hooks/pai-hooks/TestGroup/TestHook/TestHook.hook.ts");

    const result = verify(installedVerifyArgs({ in: "/project" }), deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("FILE_MISSING");
    }
  });

  it("--fix in installed mode → error", () => {
    const deps = new InMemoryDeps(makeInstalledProject(), "/source");
    const result = verify(
      { command: "verify", names: [], flags: { installed: true, fix: true } },
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PaihErrorCode.InvalidArgs);
      expect(result.error.message).toContain("paih update");
    }
  });

  it("missing lockfile → LOCK_MISSING", () => {
    const deps = new InMemoryDeps({
      "/project/.claude/settings.json": "{}",
    }, "/project");

    const result = verify(installedVerifyArgs({ in: "/project" }), deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PaihErrorCode.LockMissing);
    }
  });

  it("missing settings entry reported", () => {
    const deps = new InMemoryDeps(makeInstalledProject(), "/source");
    install(installArgs(["TestHook"]), deps, "/source");

    // Clear settings to simulate missing entry
    deps.addFile("/project/.claude/settings.json", "{}");

    const result = verify(installedVerifyArgs({ in: "/project" }), deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("SETTINGS_MISSING");
    }
  });
});
