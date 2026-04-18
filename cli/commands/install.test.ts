/**
 * Install command integration tests — end-to-end via InMemoryDeps.
 *
 * Verifies the full install pipeline: resolve → stage → settings merge → lockfile → tsconfig.
 *
 * Uses InMemoryDeps from cli/types/deps.ts
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-a0619c6a/cli/types/deps.ts)
 * and the install function from cli/commands/install.ts
 * (see /Users/hogers/.claude/pai-hooks/.claude/worktrees/agent-a0619c6a/cli/commands/install.ts).
 */

import { describe, expect, it } from "bun:test";
import { install } from "@hooks/cli/commands/install";
import type { ParsedArgs } from "@hooks/cli/core/args";
import { PaihErrorCode } from "@hooks/cli/core/error";
import type { SettingsJson } from "@hooks/cli/core/settings";
import { InMemoryDeps } from "@hooks/cli/types/deps";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

/** Build a minimal source repo in InMemoryDeps with one hook. */
function makeSourceRepo(): Record<string, string> {
  return {
    // Source repo at /source
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
      "// TypeStrictness hook\nexport default {};\n",
    "/source/hooks/CodingStandards/TypeStrictness/TypeStrictness.contract.ts":
      "// TypeStrictness contract\nexport default {};\n",
    "/source/core/result.ts": "// core result module\nexport const ok = true;\n",
    "/source/presets.json": JSON.stringify({
      quality: {
        description: "Code quality",
        groups: ["CodingStandards"],
      },
    }),

    // Target project at /project with .claude/
    "/project/.claude/settings.json": "{}",
  };
}

/** Build a source repo with a group containing multiple hooks and shared deps. */
function makeMultiHookRepo(): Record<string, string> {
  return {
    ...makeSourceRepo(),
    "/source/hooks/CodingStandards/group.json": JSON.stringify({
      name: "CodingStandards",
      description: "TypeScript quality enforcement hooks",
      hooks: ["TypeStrictness", "BashWriteGuard"],
      sharedFiles: [],
    }),
    "/source/hooks/CodingStandards/BashWriteGuard/hook.json": JSON.stringify({
      name: "BashWriteGuard",
      group: "CodingStandards",
      event: "PreToolUse",
      description: "Guards bash writes",
      schemaVersion: 1,
      deps: { core: ["result"], lib: [], adapters: [], shared: false },
      tags: [],
      presets: [],
    }),
    "/source/hooks/CodingStandards/BashWriteGuard/BashWriteGuard.hook.ts":
      "// BashWriteGuard hook\nexport default {};\n",
    "/source/hooks/CodingStandards/BashWriteGuard/BashWriteGuard.contract.ts":
      "// BashWriteGuard contract\nexport default {};\n",
  };
}

function makeArgs(names: string[], flags: Record<string, boolean | string> = {}): ParsedArgs {
  return { command: "install", names, flags: { to: "/project", ...flags } };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("install command", () => {
  it("installs a single hook — files copied, settings merged, lockfile written", () => {
    const deps = new InMemoryDeps(makeSourceRepo(), "/source");
    const result = install(makeArgs(["TypeStrictness"]), deps, "/source");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    const files = deps.getFiles();

    // Hook files copied
    expect(
      files.has(
        "/project/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
      ),
    ).toBe(true);
    expect(
      files.has(
        "/project/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.contract.ts",
      ),
    ).toBe(true);

    // Core dep deduped into pai-hooks/
    expect(files.has("/project/.claude/hooks/pai-hooks/core/result.ts")).toBe(true);

    // Settings merged
    const settingsContent = files.get("/project/.claude/settings.json")!;
    const settings: SettingsJson = JSON.parse(settingsContent);
    expect(settings.hooks?.PreToolUse).toBeDefined();
    expect(settings.hooks?.PreToolUse?.[0].hooks[0].command).toBe(
      'bun "$CLAUDE_PROJECT_DIR"/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts',
    );

    // Lockfile written
    expect(files.has("/project/.claude/hooks/pai-hooks/paih.lock.json")).toBe(true);
    const lockContent = files.get("/project/.claude/hooks/pai-hooks/paih.lock.json")!;
    const lock = JSON.parse(lockContent);
    expect(lock.lockfileVersion).toBe(1);
    expect(lock.hooks).toHaveLength(1);
    expect(lock.hooks[0].name).toBe("TypeStrictness");

    // tsconfig.json generated
    expect(files.has("/project/.claude/hooks/pai-hooks/tsconfig.json")).toBe(true);
    const tsconfig = JSON.parse(files.get("/project/.claude/hooks/pai-hooks/tsconfig.json")!);
    expect(tsconfig.compilerOptions.paths["@hooks/hooks/*"]).toEqual(["./*"]);
    expect(tsconfig.compilerOptions.paths["@hooks/*"]).toEqual(["./*"]);
  });

  it("installs a group — all group hooks installed", () => {
    const deps = new InMemoryDeps(makeMultiHookRepo(), "/source");
    const result = install(makeArgs(["CodingStandards"]), deps, "/source");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    const files = deps.getFiles();
    expect(
      files.has(
        "/project/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
      ),
    ).toBe(true);
    expect(
      files.has(
        "/project/.claude/hooks/pai-hooks/CodingStandards/BashWriteGuard/BashWriteGuard.hook.ts",
      ),
    ).toBe(true);

    const lockContent = files.get("/project/.claude/hooks/pai-hooks/paih.lock.json")!;
    const lock = JSON.parse(lockContent);
    expect(lock.hooks).toHaveLength(2);
  });

  it("installs a preset — expands groups", () => {
    const deps = new InMemoryDeps(makeSourceRepo(), "/source");
    const result = install(makeArgs(["quality"]), deps, "/source");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);

    const files = deps.getFiles();
    expect(
      files.has(
        "/project/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
      ),
    ).toBe(true);
  });

  it("is idempotent — re-install does not duplicate settings entries", () => {
    const deps = new InMemoryDeps(makeSourceRepo(), "/source");

    // First install
    const r1 = install(makeArgs(["TypeStrictness"]), deps, "/source");
    expect(r1.ok).toBe(true);

    // Second install
    const r2 = install(makeArgs(["TypeStrictness"]), deps, "/source");
    expect(r2.ok).toBe(true);

    const files = deps.getFiles();
    const settingsContent = files.get("/project/.claude/settings.json")!;
    const settings: SettingsJson = JSON.parse(settingsContent);

    // Only one entry, not two
    const allCommands =
      settings.hooks?.PreToolUse?.flatMap((g) => g.hooks.map((h) => h.command)) ?? [];
    const tsCommands = allCommands.filter((c) => c.includes("TypeStrictness"));
    expect(tsCommands).toHaveLength(1);
  });

  it("returns TARGET_NOT_FOUND when .claude/ is missing", () => {
    const deps = new InMemoryDeps(
      {
        "/source/hooks/CodingStandards/TypeStrictness/hook.json": "{}",
      },
      "/source",
    );
    const args = makeArgs(["TypeStrictness"], { to: "/nowhere" });
    const result = install(args, deps, "/source");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PaihErrorCode.TargetNotFound);
    }
  });

  it("--to flag installs to specified location", () => {
    const fileTree = {
      ...makeSourceRepo(),
      "/other/.claude/settings.json": "{}",
    };
    const deps = new InMemoryDeps(fileTree, "/source");
    const args = makeArgs(["TypeStrictness"], { to: "/other" });
    const result = install(args, deps, "/source");

    expect(result.ok).toBe(true);
    const files = deps.getFiles();
    expect(
      files.has(
        "/other/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
      ),
    ).toBe(true);
  });

  it("--dry-run previews without writing", () => {
    const deps = new InMemoryDeps(makeSourceRepo(), "/source");
    const args = makeArgs(["TypeStrictness"], { to: "/project", dryRun: true });
    const result = install(args, deps, "/source");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("Dry run");
      expect(result.value).toContain("TypeStrictness");
    }

    // No files written to target
    const files = deps.getFiles();
    expect(
      files.has(
        "/project/.claude/hooks/pai-hooks/CodingStandards/TypeStrictness/TypeStrictness.hook.ts",
      ),
    ).toBe(false);
  });

  it("returns HOOK_NOT_FOUND for unknown name", () => {
    const deps = new InMemoryDeps(makeSourceRepo(), "/source");
    const result = install(makeArgs(["NonExistent"]), deps, "/source");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PaihErrorCode.HookNotFound);
    }
  });

  it("returns INVALID_ARGS when no names provided", () => {
    const deps = new InMemoryDeps(makeSourceRepo(), "/source");
    const result = install(makeArgs([]), deps, "/source");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PaihErrorCode.InvalidArgs);
    }
  });

  it("installs hooks with shared deps — shared.ts copied to group dir", () => {
    const fileTree: Record<string, string> = {
      ...makeSourceRepo(),
      "/source/hooks/AgentLifecycle/group.json": JSON.stringify({
        name: "AgentLifecycle",
        description: "Agent lifecycle hooks",
        hooks: ["AgentLifecycleStart"],
        sharedFiles: ["shared.ts"],
      }),
      "/source/hooks/AgentLifecycle/shared.ts": "// shared module\nexport const shared = true;\n",
      "/source/hooks/AgentLifecycle/AgentLifecycleStart/hook.json": JSON.stringify({
        name: "AgentLifecycleStart",
        group: "AgentLifecycle",
        event: "SubagentStart",
        description: "Start hook",
        schemaVersion: 1,
        tags: [],
        presets: [],
      }),
      "/source/hooks/AgentLifecycle/AgentLifecycleStart/AgentLifecycleStart.contract.ts":
        'import { ok } from "@hooks/core/result";\nimport { shared } from "@hooks/hooks/AgentLifecycle/shared";\nexport const AgentLifecycleStart = { name: "AgentLifecycleStart", event: "SubagentStart" };\n',
      "/source/hooks/AgentLifecycle/AgentLifecycleStart/AgentLifecycleStart.hook.ts":
        "// hook\nexport default {};\n",
    };
    const deps = new InMemoryDeps(fileTree, "/source");
    const result = install(makeArgs(["AgentLifecycleStart"]), deps, "/source");

    expect(result.ok).toBe(true);
    const files = deps.getFiles();
    expect(files.has("/project/.claude/hooks/pai-hooks/AgentLifecycle/shared.ts")).toBe(true);
    expect(
      files.has(
        "/project/.claude/hooks/pai-hooks/AgentLifecycle/AgentLifecycleStart/AgentLifecycleStart.hook.ts",
      ),
    ).toBe(true);
  });
});
