/**
 * Manifest Loader Tests — exercises loadManifests including JSON parse errors.
 */

import { describe, expect, it } from "bun:test";
import { InMemoryDeps } from "@hooks/cli/types/deps";
import { loadManifests } from "@hooks/cli/core/manifest-loader";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const VALID_HOOK = JSON.stringify({
  name: "TestHook",
  group: "TestGroup",
  event: "PreToolUse",
  description: "test",
  schemaVersion: 1,
});

const VALID_GROUP = JSON.stringify({
  name: "TestGroup",
  description: "test group",
  hooks: ["TestHook"],
  sharedFiles: [],
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("loadManifests", () => {
  it("loads valid hook and group manifests", () => {
    const deps = new InMemoryDeps({
      "/repo/hooks/TestGroup/group.json": VALID_GROUP,
      "/repo/hooks/TestGroup/TestHook/hook.json": VALID_HOOK,
    });
    const result = loadManifests("/repo", deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hooks.has("TestHook")).toBe(true);
    expect(result.value.groups.has("TestGroup")).toBe(true);
  });

  it("skips hooks with malformed hook.json (JSON parse error)", () => {
    const deps = new InMemoryDeps({
      "/repo/hooks/TestGroup/group.json": VALID_GROUP,
      "/repo/hooks/TestGroup/BadHook/hook.json": "{ not valid json !!!",
      "/repo/hooks/TestGroup/GoodHook/hook.json": VALID_HOOK,
    });
    const result = loadManifests("/repo", deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hooks.has("BadHook")).toBe(false);
    expect(result.value.hooks.has("GoodHook")).toBe(true);
  });

  it("skips malformed group.json gracefully", () => {
    const deps = new InMemoryDeps({
      "/repo/hooks/BadGroup/group.json": "broken {{{",
      "/repo/hooks/BadGroup/TestHook/hook.json": VALID_HOOK,
    });
    const result = loadManifests("/repo", deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.groups.has("BadGroup")).toBe(false);
    expect(result.value.hooks.has("TestHook")).toBe(true);
  });

  it("returns empty index when hooks dir does not exist", () => {
    const deps = new InMemoryDeps({});
    const result = loadManifests("/repo", deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hooks.size).toBe(0);
    expect(result.value.groups.size).toBe(0);
  });
});
