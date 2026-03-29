/**
 * Hook & Group Installation Independence Tests
 *
 * Verifies that every hook and every hook group in the repository can be
 * installed independently via the CLI install pipeline. Builds a virtual
 * source tree from the real repo files, then for each hook/group, creates
 * a clean target and asserts install() succeeds.
 *
 * Runs in a tmp-like in-memory filesystem — no real disk writes.
 */

import { beforeAll, describe, expect, it } from "bun:test";
import { join, relative } from "node:path";
import {
  fileExists,
  readDir,
  readFile,
  stat as adapterStat,
} from "@hooks/core/adapters/fs";
import { install } from "@hooks/cli/commands/install";
import type { ParsedArgs } from "@hooks/cli/core/args";
import { InMemoryDeps } from "@hooks/cli/types/deps";

// ─── Source Tree Loader ────────────────────────────────────────────────────

const REPO_ROOT = join(import.meta.dir, "../..");

interface SourceTree {
  files: Record<string, string>;
  hookNames: string[];
  groupNames: string[];
}

function walkDir(dir: string, base: string, files: Record<string, string>): void {
  if (!fileExists(dir)) return;
  const entries = readDir(dir, { withFileTypes: true });
  if (!entries.ok) return;
  for (const entry of entries.value) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules, .git, docs, test-fixtures
      if (["node_modules", ".git", "docs", "test-fixtures", ".claude"].includes(entry.name))
        continue;
      walkDir(fullPath, base, files);
    } else if (entry.isFile()) {
      const rel = relative(base, fullPath);
      const virtualPath = `/source/${rel}`;
      // Only load files needed for install: .ts, .json, shared files
      if (
        entry.name.endsWith(".ts") ||
        entry.name.endsWith(".json") ||
        entry.name === "shared.ts"
      ) {
        const content = readFile(fullPath);
        if (content.ok) {
          files[virtualPath] = content.value;
        }
      }
    }
  }
}

function loadSourceTree(): SourceTree {
  const files: Record<string, string> = {};

  // Load hooks/, core/, lib/ directories
  walkDir(join(REPO_ROOT, "hooks"), REPO_ROOT, files);
  walkDir(join(REPO_ROOT, "core"), REPO_ROOT, files);
  walkDir(join(REPO_ROOT, "lib"), REPO_ROOT, files);

  // Load presets.json
  const presetsPath = join(REPO_ROOT, "presets.json");
  if (fileExists(presetsPath)) {
    const content = readFile(presetsPath);
    if (content.ok) {
      files["/source/presets.json"] = content.value;
    }
  }

  // Discover hook names from hook.json files
  const hookNames: string[] = [];
  const groupNames = new Set<string>();

  const hooksDir = join(REPO_ROOT, "hooks");
  const groupEntries = readDir(hooksDir, { withFileTypes: true });
  if (!groupEntries.ok) return { files, hookNames: [], groupNames: [] };

  for (const groupEntry of groupEntries.value) {
    if (!groupEntry.isDirectory()) continue;
    const groupDir = join(hooksDir, groupEntry.name);

    const groupJsonPath = join(groupDir, "group.json");
    if (fileExists(groupJsonPath)) {
      groupNames.add(groupEntry.name);
    }

    const hookEntries = readDir(groupDir, { withFileTypes: true });
    if (!hookEntries.ok) continue;

    for (const hookEntry of hookEntries.value) {
      if (!hookEntry.isDirectory()) continue;
      const hookDir = join(groupDir, hookEntry.name);

      const hookJsonPath = join(hookDir, "hook.json");
      if (fileExists(hookJsonPath)) {
        hookNames.push(hookEntry.name);
      }
    }
  }

  return { files, hookNames: hookNames.sort(), groupNames: [...groupNames].sort() };
}

// ─── Test Helpers ──────────────────────────────────────────────────────────

function makeArgs(names: string[]): ParsedArgs {
  return { command: "install", names, flags: { to: "/project" } };
}

function makeDeps(sourceFiles: Record<string, string>): InMemoryDeps {
  return new InMemoryDeps(
    {
      ...sourceFiles,
      "/project/.claude/settings.json": "{}",
    },
    "/source",
  );
}

// ─── Tests ─────────────────────────────────────────────────────────────────

let tree: SourceTree;

beforeAll(() => {
  tree = loadSourceTree();
});

describe("independent hook installation", () => {
  it("discovered hooks from repository", () => {
    expect(tree.hookNames.length).toBeGreaterThan(0);
  });

  // Dynamically generated tests won't work with beforeAll,
  // so we load eagerly and generate at module level.
  const eagerTree = loadSourceTree();

  for (const hookName of eagerTree.hookNames) {
    it(`installs hook "${hookName}" independently`, () => {
      const deps = makeDeps(eagerTree.files);
      const result = install(makeArgs([hookName]), deps, "/source");

      if (!result.ok) {
        // Provide actionable failure message
        throw new Error(`Failed to install hook "${hookName}": ${result.error.message}`);
      }

      expect(result.ok).toBe(true);

      // Verify hook files were staged
      const files = deps.getFiles();
      const hookFilePattern = `pai-hooks/`;
      const hasHookFiles = [...files.keys()].some(
        (k) => k.includes(hookFilePattern) && k.includes(hookName),
      );
      expect(hasHookFiles).toBe(true);

      // Verify settings were merged
      const settingsContent = files.get("/project/.claude/settings.json")!;
      const settings = JSON.parse(settingsContent);
      expect(settings.hooks).toBeDefined();

      // Verify lockfile was written
      expect(files.has("/project/.claude/hooks/pai-hooks/paih.lock.json")).toBe(true);
    });
  }
});

describe("independent group installation", () => {
  it("discovered groups from repository", () => {
    expect(tree.groupNames.length).toBeGreaterThan(0);
  });

  const eagerTree = loadSourceTree();

  for (const groupName of eagerTree.groupNames) {
    it(`installs group "${groupName}" independently`, () => {
      const deps = makeDeps(eagerTree.files);
      const result = install(makeArgs([groupName]), deps, "/source");

      if (!result.ok) {
        throw new Error(`Failed to install group "${groupName}": ${result.error.message}`);
      }

      expect(result.ok).toBe(true);

      // Verify at least one hook file was staged for this group
      const files = deps.getFiles();
      const groupDir = `/project/.claude/hooks/pai-hooks/${groupName}/`;
      const hasGroupFiles = [...files.keys()].some((k) => k.startsWith(groupDir));
      expect(hasGroupFiles).toBe(true);

      // Verify settings were merged with at least one event
      const settingsContent = files.get("/project/.claude/settings.json")!;
      const settings = JSON.parse(settingsContent);
      expect(settings.hooks).toBeDefined();
      expect(Object.keys(settings.hooks).length).toBeGreaterThan(0);

      // Verify lockfile tracks all hooks in group
      const lockContent = files.get("/project/.claude/hooks/pai-hooks/paih.lock.json")!;
      const lock = JSON.parse(lockContent);
      expect(lock.hooks.length).toBeGreaterThan(0);

      // All lockfile entries should belong to this group
      for (const entry of lock.hooks) {
        expect(entry.group).toBe(groupName);
      }
    });
  }
});
