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

  it("calls onError with pattern and error when pattern is invalid", () => {
    const spy: Array<{ pattern: string; err: Error }> = [];
    const result = safeRegexTest("test", "[invalid((", "", (pattern, err) =>
      spy.push({ pattern, err }),
    );
    expect(result).toBe(false);
    expect(spy).toHaveLength(1);
    expect(spy[0].pattern).toBe("[invalid((");
    expect(spy[0].err).toBeInstanceOf(Error);
  });

  it("does not call onError when pattern is valid", () => {
    const spy: Array<{ pattern: string; err: Error }> = [];
    const result = safeRegexTest("hello", "hello", "", (pattern, err) =>
      spy.push({ pattern, err }),
    );
    expect(result).toBe(true);
    expect(spy).toHaveLength(0);
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

  it("calls onError with pattern and error when pattern is invalid", () => {
    const spy: Array<{ pattern: string; err: Error }> = [];
    const result = createRegex("[invalid((", "", (pattern, err) => spy.push({ pattern, err }));
    expect(result).toBeNull();
    expect(spy).toHaveLength(1);
    expect(spy[0].pattern).toBe("[invalid((");
    expect(spy[0].err).toBeInstanceOf(Error);
  });

  it("does not call onError when pattern is valid", () => {
    const spy: Array<{ pattern: string; err: Error }> = [];
    const result = createRegex("^hello$", "", (pattern, err) => spy.push({ pattern, err }));
    expect(result).not.toBeNull();
    expect(spy).toHaveLength(0);
  });
});
