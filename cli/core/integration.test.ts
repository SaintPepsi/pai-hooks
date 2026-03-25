/**
 * Integration smoke test — Wire resolver + adapters through pipe().
 *
 * Verifies the full flow: target resolution → manifest loading → resolution
 * using InMemoryDeps as the filesystem layer.
 */

import { describe, it, expect } from "bun:test";
import { pipe } from "@hooks/cli/core/pipe";
import { ok } from "@hooks/cli/core/result";
import type { Result } from "@hooks/cli/core/result";
import type { PaihError } from "@hooks/cli/core/error";
import { resolveTarget } from "@hooks/cli/core/target";
import { resolve, type ManifestIndex } from "@hooks/cli/core/resolver";
import type { HookDef, ResolvedHooks } from "@hooks/cli/types/resolved";
import type { HookManifest, GroupManifest } from "@hooks/cli/types/manifest";
import { InMemoryDeps } from "@hooks/cli/types/deps";

describe("integration: resolver + adapters through pipe()", () => {
  it("resolves target then resolves hooks in a pipeline", () => {
    // Set up in-memory filesystem with .claude/ directory
    const deps = new InMemoryDeps({
      "/project/.claude/settings.json": "{}",
    }, "/project/src");

    // Step 1: resolve target
    const targetResult = resolveTarget(deps, "/project/src");
    expect(targetResult.ok).toBe(true);

    // Step 2: build manifest index (simulating what a real loader would do)
    const hookDef: HookDef = {
      manifest: {
        name: "SecurityValidator",
        group: "Security",
        event: "PreToolUse",
        description: "Validates security",
        schemaVersion: 1,
        deps: { core: ["result"], lib: [], adapters: ["fs"], shared: false },
        tags: ["security"],
        presets: ["standard"],
      },
      contractPath: "/hooks/Security/SecurityValidator/SecurityValidator.ts",
      manifestPath: "/hooks/Security/SecurityValidator/hook.json",
      sourceDir: "/hooks/Security/SecurityValidator",
    };

    const group: GroupManifest = {
      name: "Security",
      description: "Security hooks",
      hooks: ["SecurityValidator"],
      sharedFiles: [],
    };

    const index: ManifestIndex = {
      hooks: new Map([["SecurityValidator", hookDef]]),
      groups: new Map([["Security", group]]),
      presets: new Map(),
    };

    // Step 3: pipe target resolution into hook resolution
    const result = pipe(
      targetResult,
      (targetDir: string): Result<ResolvedHooks, PaihError> => {
        // In a real flow, we'd load manifests from targetDir
        // Here we use our pre-built index
        return resolve(["SecurityValidator"], index);
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hooks).toHaveLength(1);
      expect(result.value.hooks[0].manifest.name).toBe("SecurityValidator");
    }
  });

  it("short-circuits when target resolution fails", () => {
    const deps = new InMemoryDeps({}, "/nowhere");

    const targetResult = resolveTarget(deps, "/nowhere");
    expect(targetResult.ok).toBe(false);

    let resolverCalled = false;
    const result = pipe(
      targetResult,
      (_targetDir: string): Result<ResolvedHooks, PaihError> => {
        resolverCalled = true;
        return ok({ hooks: [], depTree: new Map() });
      },
    );

    expect(result.ok).toBe(false);
    expect(resolverCalled).toBe(false);
  });
});
