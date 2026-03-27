/**
 * Lifecycle integration tests — full install → verify → update → uninstall flows.
 *
 * Uses InMemoryDeps from cli/types/deps.ts.
 * Tests the full pipeline across install (cli/commands/install.ts),
 * verify (cli/commands/verify.ts), update (cli/commands/update.ts),
 * and uninstall (cli/commands/uninstall.ts).
 */

import { describe, it, expect } from "bun:test";
import { install } from "@hooks/cli/commands/install";
import { verify } from "@hooks/cli/commands/verify";
import { update } from "@hooks/cli/commands/update";
import { uninstall } from "@hooks/cli/commands/uninstall";
import type { ParsedArgs } from "@hooks/cli/core/args";
import { InMemoryDeps } from "@hooks/cli/types/deps";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeSourceRepo(): Record<string, string> {
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
      deps: { core: ["result"], lib: [], adapters: [], shared: false },
      tags: [],
      presets: [],
    }),
    "/source/hooks/TestGroup/TestHook/TestHook.hook.ts":
      '// TestHook v1\nimport { ok } from "@hooks/core/result";\nexport default {};\n',
    "/source/hooks/TestGroup/TestHook/TestHook.contract.ts":
      "export default {};",
    "/source/core/result.ts": "export const ok = true;",
    "/source/presets.json": "{}",
    "/project/.claude/settings.json": "{}",
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("lifecycle integration", () => {
  it("install → verify (clean) → modify file → verify (drift) → update → verify (clean)", () => {
    const deps = new InMemoryDeps(makeSourceRepo(), "/source");

    // Step 1: Install
    const installResult = install(
      { command: "install", names: ["TestHook"], flags: { to: "/project" } },
      deps,
      "/source",
    );
    expect(installResult.ok).toBe(true);

    // Step 2: Verify (should be clean)
    const verifyClean = verify(
      { command: "verify", names: [], flags: { installed: true, in: "/project" } },
      deps,
    );
    expect(verifyClean.ok).toBe(true);
    if (verifyClean.ok) {
      expect(verifyClean.value).toContain("No drift detected");
    }

    // Step 3: Modify an installed file
    deps.addFile(
      "/project/.claude/hooks/pai-hooks/TestGroup/TestHook/TestHook.hook.ts",
      "// MODIFIED BY USER\n",
    );

    // Step 4: Verify (should detect drift)
    const verifyDrift = verify(
      { command: "verify", names: [], flags: { installed: true, in: "/project" } },
      deps,
    );
    expect(verifyDrift.ok).toBe(true);
    if (verifyDrift.ok) {
      expect(verifyDrift.value).toContain("FILE_MODIFIED");
    }

    // Step 5: Update with --force (source unchanged, but local is modified)
    // First modify the source so update has something to do
    deps.addFile(
      "/source/hooks/TestGroup/TestHook/TestHook.hook.ts",
      '// TestHook v2\nimport { ok } from "@hooks/core/result";\nexport default {};\n',
    );

    const updateResult = update(
      { command: "update", names: [], flags: { in: "/project", force: true } },
      deps,
      "/source",
    );
    expect(updateResult.ok).toBe(true);

    // Step 6: Verify again (should be clean)
    const verifyAfterUpdate = verify(
      { command: "verify", names: [], flags: { installed: true, in: "/project" } },
      deps,
    );
    expect(verifyAfterUpdate.ok).toBe(true);
    if (verifyAfterUpdate.ok) {
      expect(verifyAfterUpdate.value).toContain("No drift detected");
    }
  });

  it("install → uninstall → verify (nothing installed)", () => {
    const deps = new InMemoryDeps(makeSourceRepo(), "/source");

    // Step 1: Install
    const installResult = install(
      { command: "install", names: ["TestHook"], flags: { to: "/project" } },
      deps,
      "/source",
    );
    expect(installResult.ok).toBe(true);

    // Step 2: Uninstall
    const uninstallResult = uninstall(
      { command: "uninstall", names: ["TestHook"], flags: { from: "/project" } },
      deps,
    );
    expect(uninstallResult.ok).toBe(true);

    // Step 3: Verify — lockfile exists but has no hooks
    const verifyResult = verify(
      { command: "verify", names: [], flags: { installed: true, in: "/project" } },
      deps,
    );
    expect(verifyResult.ok).toBe(true);
    if (verifyResult.ok) {
      expect(verifyResult.value).toContain("No hooks installed");
    }
  });
});
