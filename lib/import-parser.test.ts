/**
 * Tests for lib/import-parser.ts — TypeScript import parsing utilities.
 *
 * Pure functions, no deps injection needed except discoverSharedFiles
 * which takes a minimal { readDir } object.
 */

import { describe, expect, it } from "bun:test";
import {
  categorizeImport,
  discoverSharedFiles,
  hookUsesShared,
  parseImports,
} from "@hooks/lib/import-parser";

// ─── categorizeImport ────────────────────────────────────────────────────────

describe("categorizeImport", () => {
  it("returns null for @hooks/hooks/* imports (sibling hooks)", () => {
    expect(categorizeImport("@hooks/hooks/SomeGroup/shared")).toBeNull();
  });

  it("returns null for @hooks/cli/* imports", () => {
    expect(categorizeImport("@hooks/cli/some-command")).toBeNull();
  });

  it("returns null for @hooks/scripts/* imports", () => {
    expect(categorizeImport("@hooks/scripts/analyze")).toBeNull();
  });

  it("categorizes @hooks/core/adapters/* as adapters", () => {
    const result = categorizeImport("@hooks/core/adapters/fs");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("adapters");
    expect(result!.dep).toBe("fs");
  });

  it("categorizes nested adapter path correctly", () => {
    const result = categorizeImport("@hooks/core/adapters/process");
    expect(result!.category).toBe("adapters");
    expect(result!.dep).toBe("process");
  });

  it("categorizes @hooks/core/* (non-adapters) as core", () => {
    const result = categorizeImport("@hooks/core/result");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("core");
    expect(result!.dep).toBe("result");
  });

  it("categorizes @hooks/core/error as core", () => {
    const result = categorizeImport("@hooks/core/error");
    expect(result!.category).toBe("core");
    expect(result!.dep).toBe("error");
  });

  it("categorizes @hooks/lib/* as lib", () => {
    const result = categorizeImport("@hooks/lib/paths");
    expect(result).not.toBeNull();
    expect(result!.category).toBe("lib");
    expect(result!.dep).toBe("paths");
  });

  it("categorizes @hooks/lib/signal-logger as lib", () => {
    const result = categorizeImport("@hooks/lib/signal-logger");
    expect(result!.category).toBe("lib");
    expect(result!.dep).toBe("signal-logger");
  });

  it("returns null for unrecognized @hooks/* path", () => {
    expect(categorizeImport("@hooks/unknown/something")).toBeNull();
  });
});

// ─── parseImports ────────────────────────────────────────────────────────────

describe("parseImports", () => {
  it("returns empty arrays for source with no imports", () => {
    const result = parseImports("const x = 1;");
    expect(result.core).toEqual([]);
    expect(result.lib).toEqual([]);
    expect(result.adapters).toEqual([]);
  });

  it("parses a single core import", () => {
    const source = `import { ok, err } from "@hooks/core/result";`;
    const result = parseImports(source);
    expect(result.core).toContain("result");
  });

  it("parses a single adapters import", () => {
    const source = `import { readFile } from "@hooks/core/adapters/fs";`;
    const result = parseImports(source);
    expect(result.adapters).toContain("fs");
  });

  it("parses a single lib import", () => {
    const source = `import { logSignal } from "@hooks/lib/signal-logger";`;
    const result = parseImports(source);
    expect(result.lib).toContain("signal-logger");
  });

  it("skips pure type imports (import type)", () => {
    const source = `import type { Result } from "@hooks/core/result";`;
    const result = parseImports(source);
    expect(result.core).toEqual([]);
  });

  it("parses multiple imports across categories", () => {
    const source = [
      `import { ok } from "@hooks/core/result";`,
      `import { readFile } from "@hooks/core/adapters/fs";`,
      `import { logSignal } from "@hooks/lib/signal-logger";`,
    ].join("\n");

    const result = parseImports(source);
    expect(result.core).toContain("result");
    expect(result.adapters).toContain("fs");
    expect(result.lib).toContain("signal-logger");
  });

  it("deduplicates repeated imports of the same module", () => {
    const source = [
      `import { ok } from "@hooks/core/result";`,
      `import { err } from "@hooks/core/result";`,
    ].join("\n");

    const result = parseImports(source);
    expect(result.core.filter((d) => d === "result")).toHaveLength(1);
  });

  it("returns sorted arrays", () => {
    const source = [
      `import { z } from "@hooks/lib/zed";`,
      `import { a } from "@hooks/lib/alpha";`,
    ].join("\n");

    const result = parseImports(source);
    expect(result.lib[0]).toBe("alpha");
    expect(result.lib[1]).toBe("zed");
  });

  it("ignores hooks/ and cli/ imports", () => {
    const source = [
      `import { foo } from "@hooks/hooks/SomeGroup/shared";`,
      `import { bar } from "@hooks/cli/utils";`,
    ].join("\n");

    const result = parseImports(source);
    expect(result.core).toEqual([]);
    expect(result.lib).toEqual([]);
    expect(result.adapters).toEqual([]);
  });

  it("handles multi-line import statements", () => {
    const source = `import {
  ok,
  err,
  type Result,
} from "@hooks/core/result";`;

    const result = parseImports(source);
    expect(result.core).toContain("result");
  });
});

// ─── discoverSharedFiles ──────────────────────────────────────────────────────

describe("discoverSharedFiles", () => {
  function makeDeps(files: string[]) {
    return {
      readDir: (_path: string) => ({ ok: true as const, value: files }),
    };
  }

  it("returns empty array when readDir fails", () => {
    const deps = { readDir: (_path: string) => ({ ok: false as const }) };
    expect(discoverSharedFiles("/some/group", deps)).toEqual([]);
  });

  it("returns shared.ts when present", () => {
    const deps = makeDeps(["shared.ts", "SomeHook.hook.ts", "hook.json"]);
    expect(discoverSharedFiles("/group", deps)).toEqual(["shared.ts"]);
  });

  it("returns *.shared.ts files", () => {
    const deps = makeDeps(["MyHook.shared.ts", "other.ts"]);
    expect(discoverSharedFiles("/group", deps)).toEqual(["MyHook.shared.ts"]);
  });

  it("returns both shared.ts and *.shared.ts files", () => {
    const deps = makeDeps(["shared.ts", "MyHook.shared.ts", "unrelated.ts"]);
    const result = discoverSharedFiles("/group", deps);
    expect(result).toContain("shared.ts");
    expect(result).toContain("MyHook.shared.ts");
    expect(result).toHaveLength(2);
  });

  it("returns sorted results", () => {
    const deps = makeDeps(["zz.shared.ts", "aa.shared.ts"]);
    const result = discoverSharedFiles("/group", deps);
    expect(result[0]).toBe("aa.shared.ts");
    expect(result[1]).toBe("zz.shared.ts");
  });

  it("ignores non-shared files", () => {
    const deps = makeDeps(["hook.ts", "contract.ts", "hook.json"]);
    expect(discoverSharedFiles("/group", deps)).toEqual([]);
  });
});

// ─── hookUsesShared ──────────────────────────────────────────────────────────

describe("hookUsesShared", () => {
  it("returns empty array when no shared files available", () => {
    const source = `import { foo } from "@hooks/hooks/MyGroup/shared";`;
    expect(hookUsesShared(source, "MyGroup", [])).toEqual([]);
  });

  it("detects usage of shared.ts", () => {
    const source = `import { foo } from "@hooks/hooks/MyGroup/shared";`;
    const result = hookUsesShared(source, "MyGroup", ["shared.ts"]);
    expect(result).toContain("shared.ts");
  });

  it("detects usage of Name.shared.ts", () => {
    const source = `import { bar } from "@hooks/hooks/MyGroup/MyHook.shared";`;
    const result = hookUsesShared(source, "MyGroup", ["MyHook.shared.ts"]);
    expect(result).toContain("MyHook.shared.ts");
  });

  it("returns only the shared files actually used", () => {
    const source = `import { foo } from "@hooks/hooks/MyGroup/shared";`;
    const result = hookUsesShared(source, "MyGroup", ["shared.ts", "Other.shared.ts"]);
    expect(result).toContain("shared.ts");
    expect(result).not.toContain("Other.shared.ts");
  });

  it("returns sorted results", () => {
    const source = [
      `import { a } from "@hooks/hooks/G/Z.shared";`,
      `import { b } from "@hooks/hooks/G/A.shared";`,
    ].join("\n");
    const result = hookUsesShared(source, "G", ["Z.shared.ts", "A.shared.ts"]);
    expect(result[0]).toBe("A.shared.ts");
    expect(result[1]).toBe("Z.shared.ts");
  });

  it("does not match a different group's shared import", () => {
    const source = `import { foo } from "@hooks/hooks/OtherGroup/shared";`;
    const result = hookUsesShared(source, "MyGroup", ["shared.ts"]);
    expect(result).toEqual([]);
  });
});
