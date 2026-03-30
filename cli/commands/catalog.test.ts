/**
 * catalog command tests — available hook/group/preset display.
 *
 * Uses InMemoryDeps from cli/types/deps.ts for filesystem simulation.
 * Manifest types follow cli/types/manifest.ts schema.
 */

import { describe, expect, it } from "bun:test";
import { catalog } from "@hooks/cli/commands/catalog";
import type { ParsedArgs } from "@hooks/cli/core/args";
import { InMemoryDeps } from "@hooks/cli/types/deps";
import type { GroupManifest, HookManifest, PresetEntry } from "@hooks/cli/types/manifest";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const HOOK_MANIFEST: HookManifest = {
  name: "TestHook",
  group: "TestGroup",
  event: "PreToolUse",
  description: "A test hook for catalog validation",
  schemaVersion: 1,
  tags: ["test", "validation"],
  presets: ["default"],
};

const GROUP_MANIFEST: GroupManifest = {
  name: "TestGroup",
  description: "A test group for catalog tests",
  hooks: ["TestHook"],
  sharedFiles: [],
};

const PRESETS: Record<string, PresetEntry> = {
  default: {
    description: "Default preset with all standard hooks",
    groups: ["TestGroup"],
  },
  minimal: {
    description: "Minimal setup",
    hooks: ["TestHook"],
  },
};

function makeArgs(flags: Record<string, boolean | string> = {}): ParsedArgs {
  return { command: "catalog", names: [], flags };
}

function makeValidDeps(): InMemoryDeps {
  return new InMemoryDeps({
    "/repo/hooks/TestGroup/group.json": JSON.stringify(GROUP_MANIFEST),
    "/repo/hooks/TestGroup/TestHook/hook.json": JSON.stringify(HOOK_MANIFEST),
    "/repo/presets.json": JSON.stringify(PRESETS),
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("catalog command — default view", () => {
  it("shows all columns for valid manifests", () => {
    const deps = makeValidDeps();
    const result = catalog(makeArgs(), deps, "/repo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toContain("TestHook");
    expect(result.value).toContain("TestGroup");
    expect(result.value).toContain("PreToolUse");
    expect(result.value).toContain("test, validation");
    expect(result.value).toContain("A test hook for catalog validation");
  });

  it("outputs JSON with --json flag", () => {
    const deps = makeValidDeps();
    const result = catalog(makeArgs({ json: true }), deps, "/repo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const parsed = JSON.parse(result.value) as HookManifest[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("TestHook");
    expect(parsed[0].event).toBe("PreToolUse");
    expect(parsed[0].tags).toEqual(["test", "validation"]);
  });

  it("shows empty state when no manifests found", () => {
    const deps = new InMemoryDeps({ "/repo/hooks/.keep": "" });
    const result = catalog(makeArgs(), deps, "/repo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toContain("No hook manifests found");
  });

  it("outputs empty JSON array when no manifests and --json", () => {
    const deps = new InMemoryDeps({ "/repo/hooks/.keep": "" });
    const result = catalog(makeArgs({ json: true }), deps, "/repo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toBe("[]");
  });
});

describe("catalog command — --groups view", () => {
  it("shows group summary", () => {
    const deps = makeValidDeps();
    const result = catalog(makeArgs({ groups: true }), deps, "/repo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toContain("TestGroup");
    expect(result.value).toContain("1");
    expect(result.value).toContain("A test group for catalog tests");
  });

  it("outputs JSON with --groups --json", () => {
    const deps = makeValidDeps();
    const result = catalog(makeArgs({ groups: true, json: true }), deps, "/repo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const parsed = JSON.parse(result.value) as GroupManifest[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("TestGroup");
    expect(parsed[0].hooks).toEqual(["TestHook"]);
  });

  it("shows empty state when no groups", () => {
    const deps = new InMemoryDeps({ "/repo/hooks/.keep": "" });
    const result = catalog(makeArgs({ groups: true }), deps, "/repo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toContain("No group manifests found");
  });
});

describe("catalog command — --presets view", () => {
  it("shows preset summary", () => {
    const deps = makeValidDeps();
    const result = catalog(makeArgs({ presets: true }), deps, "/repo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toContain("default");
    expect(result.value).toContain("minimal");
    expect(result.value).toContain("group:TestGroup");
    expect(result.value).toContain("TestHook");
  });

  it("outputs JSON with --presets --json", () => {
    const deps = makeValidDeps();
    const result = catalog(makeArgs({ presets: true, json: true }), deps, "/repo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const parsed = JSON.parse(result.value) as Record<string, PresetEntry>;
    expect(parsed.default.description).toBe("Default preset with all standard hooks");
    expect(parsed.default.groups).toEqual(["TestGroup"]);
    expect(parsed.minimal.hooks).toEqual(["TestHook"]);
  });

  it("shows empty state when no presets", () => {
    const deps = new InMemoryDeps({
      "/repo/hooks/TestGroup/group.json": JSON.stringify(GROUP_MANIFEST),
      "/repo/hooks/TestGroup/TestHook/hook.json": JSON.stringify(HOOK_MANIFEST),
    });
    const result = catalog(makeArgs({ presets: true }), deps, "/repo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toContain("No presets found");
  });
});

describe("catalog command — malformed manifests", () => {
  it("skips malformed hook.json with warning", () => {
    const deps = new InMemoryDeps({
      "/repo/hooks/BadGroup/BadHook/hook.json": "{ not valid json !!!",
    });
    const result = catalog(makeArgs(), deps, "/repo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toContain("Warning: Skipping malformed hook.json");
    expect(result.value).toContain("No hook manifests found");
  });

  it("skips malformed group.json with warning in --groups view", () => {
    const deps = new InMemoryDeps({
      "/repo/hooks/BadGroup/group.json": "{ broken }}}",
      "/repo/hooks/BadGroup/GoodHook/hook.json": JSON.stringify(HOOK_MANIFEST),
    });
    const result = catalog(makeArgs({ groups: true }), deps, "/repo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toContain("Warning: Skipping malformed group.json");
  });

  it("skips malformed presets.json with warning", () => {
    const deps = new InMemoryDeps({
      "/repo/hooks/TestGroup/TestHook/hook.json": JSON.stringify(HOOK_MANIFEST),
      "/repo/presets.json": "{ broken json !!!",
    });
    const result = catalog(makeArgs({ presets: true }), deps, "/repo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toContain("Warning: Skipping malformed presets.json");
  });

  it("shows no warnings in --json mode", () => {
    const deps = new InMemoryDeps({
      "/repo/hooks/BadGroup/BadHook/hook.json": "{ not valid json !!!",
    });
    const result = catalog(makeArgs({ json: true }), deps, "/repo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // JSON mode: no warnings in output, just empty array
    expect(result.value).toBe("[]");
    expect(result.value).not.toContain("Warning");
  });
});

describe("catalog command — no hooks dir", () => {
  it("shows empty state when hooks/ directory does not exist", () => {
    const deps = new InMemoryDeps({ "/repo/README.md": "" });
    const result = catalog(makeArgs(), deps, "/repo");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toContain("No hook manifests found");
  });
});
