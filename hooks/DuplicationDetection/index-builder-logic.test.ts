/**
 * Tests for index-builder-logic.ts source heuristic functions.
 */

import { describe, expect, test } from "bun:test";
import { isSourceFile, kebabToCamel } from "./index-builder-logic";

// ─── kebabToCamel ───────────────────────────────────────────────────────────

describe("kebabToCamel", () => {
  test("converts kebab-case to camelCase", () => {
    expect(kebabToCamel("hook-config")).toBe("hookConfig");
  });

  test("converts multi-segment kebab-case", () => {
    expect(kebabToCamel("tool-input-parser")).toBe("toolInputParser");
  });

  test("preserves already camelCase", () => {
    expect(kebabToCamel("hookConfig")).toBe("hookConfig");
  });

  test("preserves single word", () => {
    expect(kebabToCamel("pipe")).toBe("pipe");
  });

  test("handles leading hyphen", () => {
    expect(kebabToCamel("-test")).toBe("Test");
  });
});

// ─── isSourceFile ───────────────────────────────────────────────────────────

describe("isSourceFile", () => {
  describe("returns true for canonical sources", () => {
    test("exact match in lib/", () => {
      expect(isSourceFile("lib/pipe.ts", "pipe", 1)).toBe(true);
    });

    test("kebab-to-camel match in lib/", () => {
      expect(isSourceFile("lib/hook-config.ts", "hookConfig", 1)).toBe(true);
    });

    test("exact match in core/", () => {
      expect(isSourceFile("core/runner.ts", "runner", 1)).toBe(true);
    });

    test("exact match in utils/", () => {
      expect(isSourceFile("utils/helpers.ts", "helpers", 1)).toBe(true);
    });

    test("exact match in shared/", () => {
      expect(isSourceFile("shared/types.ts", "types", 1)).toBe(true);
    });

    test("nested path with source dir", () => {
      expect(isSourceFile("src/lib/tool-input.ts", "toolInput", 1)).toBe(true);
    });
  });

  describe("returns false for non-sources", () => {
    test("multi-function file", () => {
      expect(isSourceFile("lib/tool-input.ts", "getFilePath", 3)).toBe(false);
    });

    test("name mismatch", () => {
      expect(isSourceFile("lib/helpers.ts", "getFilePath", 1)).toBe(false);
    });

    test("wrong directory", () => {
      expect(isSourceFile("src/utils.ts", "utils", 1)).toBe(false);
    });

    test("hooks directory (not a source dir)", () => {
      expect(isSourceFile("hooks/DuplicationChecker/contract.ts", "contract", 1)).toBe(false);
    });

    test("zero functions", () => {
      expect(isSourceFile("lib/types.ts", "types", 0)).toBe(false);
    });
  });
});
