/**
 * Tests for core/adapters/regex.ts — safe regex construction.
 */

import { describe, expect, it } from "bun:test";
import { createRegex, safeRegexTest } from "@hooks/core/adapters/regex";

describe("safeRegexTest", () => {
  it("returns true for matching pattern", () => {
    expect(safeRegexTest("hello world", "hello")).toBe(true);
  });

  it("returns false for non-matching pattern", () => {
    expect(safeRegexTest("hello", "xyz")).toBe(false);
  });

  it("returns false for invalid regex pattern", () => {
    expect(safeRegexTest("test", "[invalid((")).toBe(false);
  });

  it("supports flags parameter", () => {
    expect(safeRegexTest("Hello", "hello", "i")).toBe(true);
  });
});

describe("createRegex", () => {
  it("returns RegExp for valid pattern", () => {
    const re = createRegex("^hello$");
    expect(re).not.toBeNull();
    expect(re!.test("hello")).toBe(true);
  });

  it("returns null for invalid pattern", () => {
    expect(createRegex("[invalid((")).toBeNull();
  });

  it("supports flags parameter", () => {
    const re = createRegex("hello", "gi");
    expect(re).not.toBeNull();
    expect(re!.flags).toContain("i");
  });
});
