/**
 * Resolver engine tests — 10-case test matrix.
 *
 * Covers: single hook, group expansion, preset expansion (direct hooks),
 * preset expansion (via groups), wildcard groups, ambiguous name collision,
 * missing hook, missing group in preset, cycle detection, multi-name union + dedup.
 */

import { describe, it, expect } from "bun:test";
import { resolve, type ManifestIndex } from "@hooks/cli/core/resolver";
import { PaihErrorCode } from "@hooks/cli/core/error";
import type { HookManifest, GroupManifest, PresetEntry } from "@hooks/cli/types/manifest";
import type { HookDef } from "@hooks/cli/types/resolved";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeHookDef(name: string, group: string, shared: string[] | false = false): HookDef {
  const manifest: HookManifest = {
    name,
    group,
    event: "PreToolUse",
    description: `Test hook ${name}`,
    schemaVersion: 1,
    deps: { core: ["result"], lib: [], adapters: ["fs"], shared },
    tags: [],
    presets: [],
  };
  return {
    manifest,
    contractPath: `/hooks/${group}/${name}/${name}.ts`,
    manifestPath: `/hooks/${group}/${name}/hook.json`,
    sourceDir: `/hooks/${group}/${name}`,
  };
}

function makeGroup(name: string, hooks: string[]): GroupManifest {
  return { name, description: `Group ${name}`, hooks, sharedFiles: [] };
}

function makeIndex(
  hookDefs: HookDef[],
  groups: GroupManifest[] = [],
  presets: Record<string, PresetEntry> = {},
): ManifestIndex {
  return {
    hooks: new Map(hookDefs.map((h) => [h.manifest.name, h])),
    groups: new Map(groups.map((g) => [g.name, g])),
    presets: new Map(Object.entries(presets)),
  };
}

// ─── Test Matrix ────────────────────────────────────────────────────────────

describe("resolver", () => {
  // 1. Single hook by name
  it("resolves a single hook by name", () => {
    const hookA = makeHookDef("HookA", "GroupA");
    const index = makeIndex([hookA]);

    const result = resolve(["HookA"], index);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hooks).toHaveLength(1);
      expect(result.value.hooks[0].manifest.name).toBe("HookA");
    }
  });

  // 2. Group expansion
  it("resolves all hooks in a group by group name", () => {
    const hookA = makeHookDef("HookA", "Safety");
    const hookB = makeHookDef("HookB", "Safety");
    const group = makeGroup("Safety", ["HookA", "HookB"]);
    const index = makeIndex([hookA, hookB], [group]);

    const result = resolve(["Safety"], index);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hooks).toHaveLength(2);
      const names = result.value.hooks.map((h) => h.manifest.name);
      expect(names).toContain("HookA");
      expect(names).toContain("HookB");
    }
  });

  // 3. Preset expansion (direct hooks list)
  it("resolves preset with direct hooks list", () => {
    const hookA = makeHookDef("HookA", "GroupA");
    const hookB = makeHookDef("HookB", "GroupB");
    const hookC = makeHookDef("HookC", "GroupC");
    const index = makeIndex([hookA, hookB, hookC], [], {
      minimal: { description: "Minimal set", hooks: ["HookA", "HookC"] },
    });

    const result = resolve(["minimal"], index);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hooks).toHaveLength(2);
      const names = result.value.hooks.map((h) => h.manifest.name);
      expect(names).toContain("HookA");
      expect(names).toContain("HookC");
    }
  });

  // 4. Preset expansion (via groups list)
  it("resolves preset with groups list", () => {
    const hookA = makeHookDef("HookA", "Safety");
    const hookB = makeHookDef("HookB", "Quality");
    const safetyGroup = makeGroup("Safety", ["HookA"]);
    const qualityGroup = makeGroup("Quality", ["HookB"]);
    const index = makeIndex([hookA, hookB], [safetyGroup, qualityGroup], {
      standard: { description: "Standard preset", groups: ["Safety", "Quality"] },
    });

    const result = resolve(["standard"], index);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hooks).toHaveLength(2);
    }
  });

  // 5. Wildcard groups: ["*"] expansion
  it("expands wildcard groups to all groups", () => {
    const hookA = makeHookDef("HookA", "Safety");
    const hookB = makeHookDef("HookB", "Quality");
    const hookC = makeHookDef("HookC", "Branding");
    const safetyGroup = makeGroup("Safety", ["HookA"]);
    const qualityGroup = makeGroup("Quality", ["HookB"]);
    const brandingGroup = makeGroup("Branding", ["HookC"]);
    const index = makeIndex(
      [hookA, hookB, hookC],
      [safetyGroup, qualityGroup, brandingGroup],
      { full: { description: "Everything", groups: ["*"] } },
    );

    const result = resolve(["full"], index);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hooks).toHaveLength(3);
    }
  });

  // 6. Ambiguous name (hook name = preset name) → hook wins
  it("resolves hook when name collides with preset name", () => {
    const hookMinimal = makeHookDef("minimal", "Special");
    const index = makeIndex([hookMinimal], [], {
      minimal: { description: "Minimal preset", hooks: ["other"] },
    });

    const result = resolve(["minimal"], index);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hooks).toHaveLength(1);
      expect(result.value.hooks[0].manifest.name).toBe("minimal");
      // It resolved as the hook, not the preset (which would have tried "other")
      expect(result.value.hooks[0].manifest.group).toBe("Special");
    }
  });

  // 7. Missing hook name
  it("returns HOOK_NOT_FOUND for missing name", () => {
    const index = makeIndex([]);

    const result = resolve(["NonExistent"], index);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PaihErrorCode.HookNotFound);
      expect(result.error.message).toContain("NonExistent");
    }
  });

  // 8. Missing group in preset (graceful — skips missing)
  it("handles preset referencing missing group gracefully", () => {
    const hookA = makeHookDef("HookA", "Safety");
    const safetyGroup = makeGroup("Safety", ["HookA"]);
    const index = makeIndex([hookA], [safetyGroup], {
      partial: { description: "Partial", groups: ["Safety", "NonExistentGroup"] },
    });

    const result = resolve(["partial"], index);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Only HookA from Safety group; NonExistentGroup is skipped
      expect(result.value.hooks).toHaveLength(1);
      expect(result.value.hooks[0].manifest.name).toBe("HookA");
    }
  });

  // 9. Shared deps are co-dependencies, not cycles
  it("shared deps do not cause false cycle detection", () => {
    const hookA = makeHookDef("HookA", "Cycle", ["shared.ts"]);
    const hookB = makeHookDef("HookB", "Cycle", ["shared.ts"]);
    const group = makeGroup("Cycle", ["HookA", "HookB"]);
    const index = makeIndex([hookA, hookB], [group]);

    const result = resolve(["Cycle"], index);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hooks).toHaveLength(2);
    }
  });

  // 10. Multi-name union + dedup
  it("resolves multiple names and deduplicates", () => {
    const hookA = makeHookDef("HookA", "Safety");
    const hookB = makeHookDef("HookB", "Safety");
    const hookC = makeHookDef("HookC", "Quality");
    const safetyGroup = makeGroup("Safety", ["HookA", "HookB"]);
    const index = makeIndex([hookA, hookB, hookC], [safetyGroup]);

    // Request HookA individually + Safety group (which includes HookA)
    const result = resolve(["HookA", "Safety", "HookC"], index);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // HookA should appear only once despite being resolved twice
      expect(result.value.hooks).toHaveLength(3);
      const names = result.value.hooks.map((h) => h.manifest.name);
      expect(names.filter((n) => n === "HookA")).toHaveLength(1);
    }
  });
});
