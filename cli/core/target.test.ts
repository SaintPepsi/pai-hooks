/**
 * Target resolution tests — walk up to .claude/ directory.
 */

import { describe, it, expect } from "bun:test";
import { resolveTarget } from "@hooks/cli/core/target";
import { PaihErrorCode } from "@hooks/cli/core/error";
import { InMemoryDeps } from "@hooks/cli/types/deps";

describe("resolveTarget()", () => {
  it("finds .claude/ in the start directory", () => {
    const deps = new InMemoryDeps({
      "/project/.claude/settings.json": "{}",
    }, "/project");

    const result = resolveTarget(deps, "/project");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("/project");
  });

  it("walks up to find .claude/ in parent", () => {
    const deps = new InMemoryDeps({
      "/project/.claude/settings.json": "{}",
      "/project/src/deep/file.ts": "",
    }, "/project/src/deep");

    const result = resolveTarget(deps, "/project/src/deep");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("/project");
  });

  it("returns TARGET_NOT_FOUND when no .claude/ exists", () => {
    const deps = new InMemoryDeps({
      "/project/src/file.ts": "",
    }, "/project/src");

    const result = resolveTarget(deps, "/project/src");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(PaihErrorCode.TargetNotFound);
    }
  });

  it("uses deps.cwd() when no startDir provided", () => {
    const deps = new InMemoryDeps({
      "/home/user/.claude/settings.json": "{}",
    }, "/home/user");

    const result = resolveTarget(deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("/home/user");
  });

  it("finds .claude/ several levels up", () => {
    const deps = new InMemoryDeps({
      "/root/.claude/settings.json": "{}",
      "/root/a/b/c/d/e/file.ts": "",
    }, "/root/a/b/c/d/e");

    const result = resolveTarget(deps, "/root/a/b/c/d/e");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("/root");
  });
});
