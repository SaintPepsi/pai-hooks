/**
 * Verify command tests — source-mode and installed-mode validation.
 *
 * Source mode: validates hook.json manifests match actual imports.
 * Installed mode: checks installed files match lockfile hashes.
 *
 * Uses InMemoryDeps from cli/types/deps.ts.
 * Tests the verify function from cli/commands/verify.ts.
 */

import { describe, expect, it } from "bun:test";
import { install } from "@hooks/cli/commands/install";
import { verify } from "@hooks/cli/commands/verify";
import type { ParsedArgs } from "@hooks/cli/core/args";
import { PaihErrorCode } from "@hooks/cli/core/error";
import { InMemoryDeps } from "@hooks/cli/types/deps";

// ─── Fixtures ───────────────────────────────────────────────────────────────

/** Source repo with a hook whose manifest is well-formed. */
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
      tags: [],
      presets: [],
    }),
    "/source/hooks/TestGroup/TestHook/TestHook.hook.ts": [
      'import { ok } from "@hooks/core/result";',
      'import { readFile } from "@hooks/core/adapters/fs";',
      "export default {};",
    ].join("\n"),
    "/source/hooks/TestGroup/TestHook/TestHook.contract.ts":
      'import { ok } from "@hooks/core/result";\nimport { readFile } from "@hooks/core/adapters/fs";\nexport default {};',
    "/source/core/result.ts": "export const ok = true;",
    "/source/presets.json": "{}",
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

  it("missing contract reported", () => {
    // Create a repo where the contract file doesn't exist
    const repo = makeCleanSourceRepo();
    delete (repo as Record<string, string>)[
      "/source/hooks/TestGroup/TestHook/TestHook.contract.ts"
    ];
    const deps = new InMemoryDeps(repo, "/source");
    const result = verify(sourceVerifyArgs(), deps, "/source");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("CONTRACT_MISSING");
    }
  });

  it("no hooks/ directory → nothing to verify", () => {
    const deps = new InMemoryDeps({}, "/empty");
    const result = verify(sourceVerifyArgs(), deps, "/empty");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("No hooks/ directory found");
    }
  });

  it("reports parse error for malformed hook.json", () => {
    const repo = makeCleanSourceRepo();
    repo["/source/hooks/TestGroup/TestHook/hook.json"] = "{ broken json !!!";
    const deps = new InMemoryDeps(repo, "/source");
    const result = verify(sourceVerifyArgs(), deps, "/source");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("MANIFEST_PARSE_ERROR");
    }
  });

  it("--fix mode rewrites stale fields and reports fixed hooks", () => {
    const repo = makeCleanSourceRepo();
    // Inject a stale field that --fix should strip
    const manifest = JSON.parse(repo["/source/hooks/TestGroup/TestHook/hook.json"]);
    manifest.deps = ["nonexistent-dep"];
    repo["/source/hooks/TestGroup/TestHook/hook.json"] = JSON.stringify(manifest);
    const deps = new InMemoryDeps(repo, "/source");
    const result = verify(sourceVerifyArgs({ fix: true }), deps, "/source");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("Fixed");
    }

    // Read manifest back and assert stale field was removed
    const rewritten = deps.readFile("/source/hooks/TestGroup/TestHook/hook.json");
    expect(rewritten.ok).toBe(true);
    if (rewritten.ok) {
      const parsed = JSON.parse(rewritten.value);
      expect(parsed.deps).toBeUndefined();
      expect(parsed.name).toBe("TestHook");
    }
  });
});

// ─── Installed Mode Tests ───────────────────────────────────────────────────

describe("verify installed-mode", () => {
  it("clean install passes", () => {
    const deps = new InMemoryDeps(makeInstalledProject(), "/source");
    const installResult = install(installArgs(["TestHook"]), deps, "/source");
    expect(installResult.ok).toBe(true);

    const result = verify(installedVerifyArgs({ in: "/project" }), deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("No drift detected");
    }
  });

  it("modified file reported", () => {
    const deps = new InMemoryDeps(makeInstalledProject(), "/source");
    const installResult = install(installArgs(["TestHook"]), deps, "/source");
    expect(installResult.ok).toBe(true);

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
    const installResult = install(installArgs(["TestHook"]), deps, "/source");
    expect(installResult.ok).toBe(true);

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
    const deps = new InMemoryDeps(
      {
        "/project/.claude/settings.json": "{}",
      },
      "/project",
    );

    const result = verify(installedVerifyArgs({ in: "/project" }), deps);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PaihErrorCode.LockMissing);
    }
  });

  it("missing settings entry reported", () => {
    const deps = new InMemoryDeps(makeInstalledProject(), "/source");
    const installResult = install(installArgs(["TestHook"]), deps, "/source");
    expect(installResult.ok).toBe(true);

    // Clear settings to simulate missing entry
    deps.addFile("/project/.claude/settings.json", "{}");

    const result = verify(installedVerifyArgs({ in: "/project" }), deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("SETTINGS_MISSING");
    }
  });
});
