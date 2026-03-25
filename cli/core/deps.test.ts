/**
 * Dependency deduplication tests.
 */

import { describe, it, expect } from "bun:test";
import { dedup } from "@hooks/cli/core/deps";
import type { HookDef } from "@hooks/cli/types/resolved";
import type { HookManifest } from "@hooks/cli/types/manifest";

function makeHookDef(name: string, sourceDir: string): HookDef {
  const manifest: HookManifest = {
    name,
    group: "TestGroup",
    event: "PreToolUse",
    description: `Test hook ${name}`,
    schemaVersion: 1,
    deps: { core: [], lib: [], adapters: [], shared: false },
    tags: [],
    presets: [],
  };
  return {
    manifest,
    contractPath: `${sourceDir}/${name}.ts`,
    manifestPath: `${sourceDir}/hook.json`,
    sourceDir,
  };
}

describe("dedup()", () => {
  it("removes duplicates by name + sourceDir identity", () => {
    const hookA = makeHookDef("HookA", "/hooks/Group/HookA");
    const hookB = makeHookDef("HookB", "/hooks/Group/HookB");
    const hookA2 = makeHookDef("HookA", "/hooks/Group/HookA");

    const result = dedup([hookA, hookB, hookA2]);
    expect(result).toHaveLength(2);
    expect(result[0].manifest.name).toBe("HookA");
    expect(result[1].manifest.name).toBe("HookB");
  });

  it("preserves first-seen ordering", () => {
    const hookC = makeHookDef("HookC", "/hooks/C");
    const hookA = makeHookDef("HookA", "/hooks/A");
    const hookB = makeHookDef("HookB", "/hooks/B");
    const hookA2 = makeHookDef("HookA", "/hooks/A");

    const result = dedup([hookC, hookA, hookB, hookA2]);
    expect(result).toHaveLength(3);
    expect(result[0].manifest.name).toBe("HookC");
    expect(result[1].manifest.name).toBe("HookA");
    expect(result[2].manifest.name).toBe("HookB");
  });

  it("keeps hooks with same name but different source dirs", () => {
    const hookA1 = makeHookDef("HookA", "/hooks/v1/HookA");
    const hookA2 = makeHookDef("HookA", "/hooks/v2/HookA");

    const result = dedup([hookA1, hookA2]);
    expect(result).toHaveLength(2);
  });

  it("handles empty input", () => {
    expect(dedup([])).toHaveLength(0);
  });

  it("deduplicates shared deps: two hooks sharing a dep get one copy", () => {
    const hookA = makeHookDef("HookA", "/hooks/Group/HookA");
    const hookB = makeHookDef("HookB", "/hooks/Group/HookB");
    // Both appear twice (simulating being resolved via different paths)
    const result = dedup([hookA, hookB, hookA, hookB]);
    expect(result).toHaveLength(2);
  });
});
