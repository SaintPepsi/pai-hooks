/**
 * Tests for adapter-registry.ts.
 *
 * Verifies extension matching, exclusion patterns, and registry helpers.
 */

import { describe, expect, test } from "bun:test";
import {
  getAdapterFor,
  getRegisteredExtensions,
  hasAdapterFor,
} from "@hooks/hooks/DuplicationDetection/adapter-registry";

// ─── getAdapterFor ────────────────────────────────────────────────────────────

describe("getAdapterFor", () => {
  test("returns typescript adapter for .ts file", () => {
    const adapter = getAdapterFor("/project/src/utils.ts");
    expect(adapter).not.toBeNull();
    expect(adapter!.name).toBe("typescript");
  });

  test("returns typescript adapter for .tsx file", () => {
    const adapter = getAdapterFor("/project/src/Button.tsx");
    expect(adapter).not.toBeNull();
    expect(adapter!.name).toBe("typescript");
  });

  test("returns null for .d.ts declaration file", () => {
    expect(getAdapterFor("/project/src/types.d.ts")).toBeNull();
  });

  test("returns null for .d.tsx declaration file", () => {
    expect(getAdapterFor("/project/src/types.d.tsx")).toBeNull();
  });

  test("returns null for .js file", () => {
    expect(getAdapterFor("/project/src/utils.js")).toBeNull();
  });

  test("returns null for .py file", () => {
    expect(getAdapterFor("/project/src/script.py")).toBeNull();
  });

  test("returns null for .css file", () => {
    expect(getAdapterFor("/project/src/styles.css")).toBeNull();
  });

  test("returns null for .md file", () => {
    expect(getAdapterFor("/project/README.md")).toBeNull();
  });

  test("excludePatterns checked before extensions (.d.ts ends with .ts)", () => {
    // .d.ts ends with .ts — exclusion must win over extension match
    expect(getAdapterFor("/project/src/global.d.ts")).toBeNull();
  });
});

// ─── hasAdapterFor ────────────────────────────────────────────────────────────

describe("hasAdapterFor", () => {
  test("returns true for .ts file", () => {
    expect(hasAdapterFor("/project/src/utils.ts")).toBe(true);
  });

  test("returns true for .tsx file", () => {
    expect(hasAdapterFor("/project/src/Button.tsx")).toBe(true);
  });

  test("returns false for .d.ts file", () => {
    expect(hasAdapterFor("/project/src/types.d.ts")).toBe(false);
  });

  test("returns false for .js file", () => {
    expect(hasAdapterFor("/project/src/utils.js")).toBe(false);
  });
});

// ─── getRegisteredExtensions ──────────────────────────────────────────────────

describe("getRegisteredExtensions", () => {
  test("includes .ts", () => {
    expect(getRegisteredExtensions()).toContain(".ts");
  });

  test("includes .tsx", () => {
    expect(getRegisteredExtensions()).toContain(".tsx");
  });

  test("returns an array", () => {
    expect(Array.isArray(getRegisteredExtensions())).toBe(true);
  });
});
