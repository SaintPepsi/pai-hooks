/**
 * Tests for the manifest generator.
 *
 * Verifies: discovery, import parsing, event extraction, merge mode,
 * dry-run, duplicate detection, shared file handling, and idempotency.
 */

import { describe, expect, it } from "bun:test";
import type { GroupManifest, HookManifest } from "@hooks/cli/types/manifest";
import type { ResultError } from "@hooks/core/error";
import { fileNotFound } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import { hookUsesShared, parseImports } from "@hooks/lib/import-parser";
import type { GeneratorDeps, GeneratorOptions } from "@hooks/scripts/generate-manifests";
import { extractEvent, generate } from "@hooks/scripts/generate-manifests";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeFs(files: Record<string, string>, dirs: Record<string, string[]>): GeneratorDeps {
  const written = new Map<string, string>();
  return {
    readFile: (path) => {
      const content = files[path] ?? written.get(path);
      if (content === undefined) return err(fileNotFound(path));
      return ok(content);
    },
    writeFile: (path, content) => {
      written.set(path, content);
      return ok(undefined);
    },
    readJson: <T = unknown>(path: string) => {
      const content = files[path] ?? written.get(path);
      if (content === undefined) return err<T, ResultError>(fileNotFound(path));
      return ok<T, ResultError>(JSON.parse(content) as T);
    },
    readDir: (path) => {
      const entries = dirs[path];
      if (!entries) return err(fileNotFound(path));
      return ok(entries);
    },
    fileExists: (path) => path in files || path in dirs || written.has(path),
    stderr: () => {},
  };
}

const SAMPLE_CONTRACT = `
import type { SyncHookContract } from "@hooks/core/contract";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { ok, type Result } from "@hooks/core/result";
import type { ResultError } from "@hooks/core/error";
import { readFile } from "@hooks/core/adapters/fs";

export const TestHook: SyncHookContract<ToolHookInput,  any> = {
  name: "TestHook",
  event: "PreToolUse",
  accepts(input) { return true; },
  execute(input, deps) { return ok({ type: "continue", continue: true }); },
  defaultDeps: {},
};
`;

function baseOptions(hooksDir: string, repoRoot: string, dryRun = false): GeneratorOptions {
  return { hooksDir, repoRoot, dryRun };
}

// ─── parseImports ───────────────────────────────────────────────────────────

describe("parseImports", () => {
  it("classifies core, lib, adapter imports correctly", () => {
    const source = `
import { ok } from "@hooks/core/result";
import { readFile } from "@hooks/core/adapters/fs";
import { pickNarrative } from "@hooks/lib/narrative-reader";
`;
    const deps = parseImports(source);
    expect(deps.core).toEqual(["result"]);
    expect(deps.adapters).toEqual(["fs"]);
    expect(deps.lib).toEqual(["narrative-reader"]);
  });

  it("excludes import type statements", () => {
    const source = `
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok } from "@hooks/core/result";
`;
    const deps = parseImports(source);
    expect(deps.core).toEqual(["result"]);
    expect(deps.core).not.toContain("contract");
    expect(deps.core).not.toContain("error");
  });

  it("includes mixed imports (value + type) as runtime deps", () => {
    const source = `import { ok, type Result } from "@hooks/core/result";`;
    const deps = parseImports(source);
    expect(deps.core).toEqual(["result"]);
  });

  it("ignores sibling hook imports", () => {
    const source = `
import { readCronFile } from "@hooks/hooks/CronStatusLine/shared";
import { ok } from "@hooks/core/result";
`;
    const deps = parseImports(source);
    expect(deps.core).toEqual(["result"]);
    expect(deps.lib).toEqual([]);
  });

  it("handles multi-line imports", () => {
    const source = `
import {
  readFile,
  writeFile,
  fileExists,
} from "@hooks/core/adapters/fs";
`;
    const deps = parseImports(source);
    expect(deps.adapters).toEqual(["fs"]);
  });

  it("sorts deps alphabetically", () => {
    const source = `
import { writeFile } from "@hooks/core/adapters/fs";
import { safeParseYaml } from "@hooks/core/adapters/yaml";
import { safeRegexTest } from "@hooks/core/adapters/regex";
`;
    const deps = parseImports(source);
    expect(deps.adapters).toEqual(["fs", "regex", "yaml"]);
  });
});

// ─── extractEvent ───────────────────────────────────────────────────────────

describe("extractEvent", () => {
  it("extracts event from contract source", () => {
    const result = extractEvent(`  event: "PreToolUse",`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("PreToolUse");
  });

  it("handles single-quoted events", () => {
    const result = extractEvent(`  event: 'PostToolUse',`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("PostToolUse");
  });

  it("returns error for missing event", () => {
    const result = extractEvent(`const x = 1;`);
    expect(result.ok).toBe(false);
  });

  it("returns error for invalid event type", () => {
    const result = extractEvent(`  event: "InvalidEvent",`);
    expect(result.ok).toBe(false);
  });
});

// ─── hookUsesShared ─────────────────────────────────────────────────────────

describe("hookUsesShared", () => {
  it("matches plain shared.ts imports", () => {
    const source = `import { readCronFile } from "@hooks/hooks/MyCronGroup/shared";`;
    const result = hookUsesShared(source, "MyCronGroup", ["shared.ts"]);
    expect(result).toEqual(["shared.ts"]);
  });

  it("matches Name.shared.ts imports", () => {
    const source = `import { enforce } from "@hooks/hooks/ObligationStateMachines/CitationEnforcement.shared";`;
    const result = hookUsesShared(source, "ObligationStateMachines", [
      "CitationEnforcement.shared.ts",
      "DocObligationStateMachine.shared.ts",
      "TestObligationStateMachine.shared.ts",
    ]);
    expect(result).toEqual(["CitationEnforcement.shared.ts"]);
  });

  it("matches multiple shared files from the same group", () => {
    const source = `
import { enforce } from "@hooks/hooks/MyGroup/Alpha.shared";
import { check } from "@hooks/hooks/MyGroup/Beta.shared";
`;
    const result = hookUsesShared(source, "MyGroup", [
      "Alpha.shared.ts",
      "Beta.shared.ts",
      "Gamma.shared.ts",
    ]);
    expect(result).toEqual(["Alpha.shared.ts", "Beta.shared.ts"]);
  });

  it("returns empty array when hook uses no shared files", () => {
    const source = `import { ok } from "@hooks/core/result";`;
    const result = hookUsesShared(source, "MyGroup", ["shared.ts"]);
    expect(result).toEqual([]);
  });

  it("does not match shared files from a different group", () => {
    const source = `import { x } from "@hooks/hooks/OtherGroup/shared";`;
    const result = hookUsesShared(source, "MyGroup", ["shared.ts"]);
    expect(result).toEqual([]);
  });
});

// ─── generate (happy path) ──────────────────────────────────────────────────

describe("generate", () => {
  it("produces correct hook.json for a single hook", () => {
    const deps = makeFs(
      { "/hooks/TestGroup/TestHook/TestHook.contract.ts": SAMPLE_CONTRACT },
      {
        "/hooks": ["TestGroup"],
        "/hooks/TestGroup": ["TestHook"],
      },
    );

    const result = generate(baseOptions("/hooks", "/repo"), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    expect(result.value.hookCount).toBe(1);
    expect(result.value.groupCount).toBe(1);

    // Find hook.json in output
    const hookFile = result.value.files.find(
      (f) => f.path.endsWith("hook.json") && f.path.includes("TestHook"),
    );
    expect(hookFile).toBeDefined();

    const manifest = JSON.parse(hookFile!.content) as HookManifest;
    expect(manifest.name).toBe("TestHook");
    expect(manifest.group).toBe("TestGroup");
    expect(manifest.event).toBe("PreToolUse");
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.tags).toEqual([]);
    expect(manifest.presets).toEqual([]);
  });

  it("discovers zero hooks when contract file is missing", () => {
    const deps = makeFs(
      {},
      {
        "/hooks": ["TestGroup"],
        "/hooks/TestGroup": ["TestHook"],
      },
    );

    const result = generate(baseOptions("/hooks", "/repo"), deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.hookCount).toBe(0);
    }
  });

  it("returns hard error for duplicate hook names across groups", () => {
    const contract = SAMPLE_CONTRACT;
    const deps = makeFs(
      {
        "/hooks/GroupA/MyHook/MyHook.contract.ts": contract,
        "/hooks/GroupB/MyHook/MyHook.contract.ts": contract,
      },
      {
        "/hooks": ["GroupA", "GroupB"],
        "/hooks/GroupA": ["MyHook"],
        "/hooks/GroupB": ["MyHook"],
      },
    );

    const result = generate(baseOptions("/hooks", "/repo"), deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("Duplicate hook name");
      expect(result.error.message).toContain("MyHook");
    }
  });

  it("dry-run produces output but writes no files", () => {
    const writtenPaths: string[] = [];
    const deps = makeFs(
      { "/hooks/TestGroup/TestHook/TestHook.contract.ts": SAMPLE_CONTRACT },
      {
        "/hooks": ["TestGroup"],
        "/hooks/TestGroup": ["TestHook"],
      },
    );

    const originalWrite = deps.writeFile;
    deps.writeFile = (path, content) => {
      writtenPaths.push(path);
      return originalWrite(path, content);
    };

    const result = generate(baseOptions("/hooks", "/repo", true), deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.files.length).toBeGreaterThan(0);
    }
    // No writes should have happened
    expect(writtenPaths).toEqual([]);
  });

  it("merge mode preserves existing tags and description", () => {
    const existingManifest: HookManifest = {
      name: "TestHook",
      group: "TestGroup",
      event: "PreToolUse",
      description: "My custom description",
      schemaVersion: 1,
      tags: ["security", "essential"],
      presets: ["minimal"],
    };

    const deps = makeFs(
      {
        "/hooks/TestGroup/TestHook/TestHook.contract.ts": SAMPLE_CONTRACT,
        "/hooks/TestGroup/TestHook/hook.json": JSON.stringify(existingManifest),
      },
      {
        "/hooks": ["TestGroup"],
        "/hooks/TestGroup": ["TestHook"],
      },
    );

    const result = generate(baseOptions("/hooks", "/repo"), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    const hookFile = result.value.files.find(
      (f) => f.path.endsWith("hook.json") && f.path.includes("TestHook"),
    );
    const manifest = JSON.parse(hookFile!.content) as HookManifest;

    // Human-curated fields preserved
    expect(manifest.description).toBe("My custom description");
    expect(manifest.tags).toEqual(["security", "essential"]);
    expect(manifest.presets).toEqual(["minimal"]);
  });

  it("generates group.json with hooks sorted alphabetically", () => {
    const contractA = SAMPLE_CONTRACT.replace(/TestHook/g, "AlphaHook");
    const contractZ = SAMPLE_CONTRACT.replace(/TestHook/g, "ZetaHook");

    const deps = makeFs(
      {
        "/hooks/MyGroup/ZetaHook/ZetaHook.contract.ts": contractZ,
        "/hooks/MyGroup/AlphaHook/AlphaHook.contract.ts": contractA,
      },
      {
        "/hooks": ["MyGroup"],
        "/hooks/MyGroup": ["ZetaHook", "AlphaHook"],
      },
    );

    const result = generate(baseOptions("/hooks", "/repo"), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    const groupFile = result.value.files.find((f) => f.path.endsWith("group.json"));
    expect(groupFile).toBeDefined();

    const group = JSON.parse(groupFile!.content) as GroupManifest;
    expect(group.hooks).toEqual(["AlphaHook", "ZetaHook"]);
  });

  it("does not create presets.json when it already exists", () => {
    const deps = makeFs(
      {
        "/hooks/TestGroup/TestHook/TestHook.contract.ts": SAMPLE_CONTRACT,
        "/repo/presets.json": '{"existing": true}',
      },
      {
        "/hooks": ["TestGroup"],
        "/hooks/TestGroup": ["TestHook"],
      },
    );

    const result = generate(baseOptions("/hooks", "/repo"), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    const presetsFile = result.value.files.find((f) => f.path.endsWith("presets.json"));
    expect(presetsFile).toBeUndefined();
  });

  it("creates presets.json when absent", () => {
    const deps = makeFs(
      { "/hooks/TestGroup/TestHook/TestHook.contract.ts": SAMPLE_CONTRACT },
      {
        "/hooks": ["TestGroup"],
        "/hooks/TestGroup": ["TestHook"],
      },
    );

    const result = generate(baseOptions("/hooks", "/repo"), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    const presetsFile = result.value.files.find((f) => f.path.endsWith("presets.json"));
    expect(presetsFile).toBeDefined();
  });

  it("is idempotent — second run produces byte-identical output", () => {
    const deps = makeFs(
      { "/hooks/TestGroup/TestHook/TestHook.contract.ts": SAMPLE_CONTRACT },
      {
        "/hooks": ["TestGroup"],
        "/hooks/TestGroup": ["TestHook"],
      },
    );

    const result1 = generate(baseOptions("/hooks", "/repo", true), deps);
    const result2 = generate(baseOptions("/hooks", "/repo", true), deps);

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (!result1.ok || !result2.ok) return;

    expect(result1.value.files.length).toBe(result2.value.files.length);
    for (let i = 0; i < result1.value.files.length; i++) {
      expect(result1.value.files[i].path).toBe(result2.value.files[i].path);
      expect(result1.value.files[i].content).toBe(result2.value.files[i].content);
    }
  });
});
