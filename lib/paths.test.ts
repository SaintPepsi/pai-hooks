/**
 * Tests for lib/paths.ts — centralized path resolution.
 */

import { describe, expect, it } from "bun:test";
import {
  defaultStderr,
  expandPath,
  getHooksDir,
  getMemoryDir,
  getPaiDir,
  getSettingsPath,
  getSkillsDir,
  paiPath,
} from "@hooks/lib/paths";

// ─── expandPath ─────────────────────────────────────────────────────────────

describe("expandPath", () => {
  it("expands $HOME prefix", () => {
    const result = expandPath("$HOME/.claude");
    expect(result).not.toContain("$HOME");
    expect(result).toContain(".claude");
  });

  it("expands ${HOME} prefix", () => {
    const result = expandPath("${HOME}/.claude");
    expect(result).not.toContain("${HOME}");
    expect(result).toContain(".claude");
  });

  it("expands ~ prefix", () => {
    const result = expandPath("~/.claude");
    expect(result).not.toContain("~");
    expect(result).toContain(".claude");
  });

  it("does not expand variables mid-path", () => {
    const result = expandPath("/opt/$HOME/data");
    expect(result).toBe("/opt/$HOME/data");
  });
});

// ─── getPaiDir ──────────────────────────────────────────────────────────────

describe("getPaiDir", () => {
  it("returns a non-empty string path", () => {
    const result = getPaiDir();
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain(".claude");
  });
});

// ─── getSettingsPath ────────────────────────────────────────────────────────

describe("getSettingsPath", () => {
  it("returns path ending with settings.json", () => {
    expect(getSettingsPath()).toContain("settings.json");
  });
});

// ─── paiPath ────────────────────────────────────────────────────────────────

describe("paiPath", () => {
  it("joins segments onto PAI_DIR", () => {
    const result = paiPath("MEMORY", "STATE");
    expect(result).toContain("MEMORY");
    expect(result).toContain("STATE");
  });
});

// ─── getHooksDir / getSkillsDir / getMemoryDir ─────────────────────────────

describe("directory helpers", () => {
  it("getHooksDir returns path containing hooks", () => {
    expect(getHooksDir()).toContain("hooks");
  });

  it("getSkillsDir returns path containing skills", () => {
    expect(getSkillsDir()).toContain("skills");
  });

  it("getMemoryDir returns path containing MEMORY", () => {
    expect(getMemoryDir()).toContain("MEMORY");
  });
});

// ─── defaultStderr ──────────────────────────────────────────────────────────

describe("defaultStderr", () => {
  it("writes without throwing", () => {
    expect(() => defaultStderr("test")).not.toThrow();
  });
});
