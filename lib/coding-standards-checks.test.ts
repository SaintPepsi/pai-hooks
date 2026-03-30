/**
 * Unit tests for coding standards violation detection functions.
 */
import { describe, expect, it } from "bun:test";
import {
  findAllViolations,
  findAsAnyCasts,
  findDirectEnvAccess,
  findInlineImportTypes,
  findRelativeImports,
  findTryCatchFlowControl,
  formatViolationSummary,
  isCommentLine,
  isExempted,
  stripStringLiterals,
} from "./coding-standards-checks";

// ─── Helper Tests ───────────────────────────────────────────────────────────

describe("isCommentLine", () => {
  it("detects single-line comments", () => {
    expect(isCommentLine("  // this is a comment")).toBe(true);
  });

  it("detects block comment lines", () => {
    expect(isCommentLine("  /* start")).toBe(true);
    expect(isCommentLine("  * middle")).toBe(true);
  });

  it("rejects non-comment lines", () => {
    expect(isCommentLine("const x = 1;")).toBe(false);
  });
});

describe("isExempted", () => {
  it("exempts line with inline marker", () => {
    const lines = ["try { // @codingstandard-exempt: boundary"];
    expect(isExempted(lines, 0)).toBe(true);
  });

  it("exempts line preceded by marker comment", () => {
    const lines = ["// @codingstandard-exempt: try-catch-boundary", "  try {"];
    expect(isExempted(lines, 1)).toBe(true);
  });

  it("does not exempt unrelated lines", () => {
    const lines = ["// normal comment", "  try {"];
    expect(isExempted(lines, 1)).toBe(false);
  });

  it("does not exempt when marker is two lines above", () => {
    const lines = ["// @codingstandard-exempt: boundary", "", "  try {"];
    expect(isExempted(lines, 2)).toBe(false);
  });
});

describe("findTryCatchFlowControl with exemption", () => {
  it("skips exempted try-catch", () => {
    const lines = [
      "// @codingstandard-exempt: try-catch-boundary",
      "  try {",
      "    return ok(fn());",
      "  } catch (e) {",
      "    return err(e);",
      "  }",
    ];
    expect(findTryCatchFlowControl(lines)).toHaveLength(0);
  });

  it("still catches non-exempted try-catch", () => {
    const lines = ["  try {", "    doSomething();", "  } catch (e) {}"];
    expect(findTryCatchFlowControl(lines)).toHaveLength(1);
  });
});

describe("stripStringLiterals", () => {
  it("strips double-quoted strings", () => {
    expect(stripStringLiterals('const msg = "hello world";')).toBe('const msg = "";');
  });

  it("strips single-quoted strings", () => {
    expect(stripStringLiterals("const msg = 'hello world';")).toBe("const msg = '';");
  });

  it("strips template literals", () => {
    expect(stripStringLiterals("const msg = `hello world`;")).toBe("const msg = ``;");
  });
});

// ─── findInlineImportTypes ──────────────────────────────────────────────────

describe("findInlineImportTypes", () => {
  it("catches type-position inline import with single quotes", () => {
    const lines = ["function run(opts: import('./parallel.ts').RunOptions): void {}"];
    const v = findInlineImportTypes(lines);
    expect(v).toHaveLength(1);
    expect(v[0].category).toBe("inline-import-type");
    expect(v[0].line).toBe(1);
  });

  it("catches type-position inline import with double quotes", () => {
    const lines = ['function run(opts: import("./parallel.ts").RunOptions): void {}'];
    const v = findInlineImportTypes(lines);
    expect(v).toHaveLength(1);
  });

  it("catches explicit type alias using inline import", () => {
    const lines = ["type Foo = import('./types.ts').MyType;"];
    const v = findInlineImportTypes(lines);
    expect(v).toHaveLength(1);
  });

  it("does NOT catch await import (runtime dynamic import)", () => {
    const lines = ["const mod = await import('./parallel.ts');"];
    expect(findInlineImportTypes(lines)).toHaveLength(0);
  });

  it("does NOT catch await import with .then()", () => {
    const lines = ["await import('./foo').then(m => m.default);"];
    expect(findInlineImportTypes(lines)).toHaveLength(0);
  });

  it("does NOT catch comment lines", () => {
    const lines = ["// opts: import('./foo').Options"];
    expect(findInlineImportTypes(lines)).toHaveLength(0);
  });
});

// ─── findAsAnyCasts ─────────────────────────────────────────────────────────

describe("findAsAnyCasts", () => {
  it("catches simple cast", () => {
    const lines = ["return value as any;"];
    const v = findAsAnyCasts(lines);
    expect(v).toHaveLength(1);
    expect(v[0].category).toBe("as-any");
    expect(v[0].line).toBe(1);
  });

  it("catches cast with property access", () => {
    const lines = ["(bar as any).method()"];
    expect(findAsAnyCasts(lines)).toHaveLength(1);
  });

  it("catches array cast", () => {
    const lines = ["const arr = items as any[];"];
    expect(findAsAnyCasts(lines)).toHaveLength(1);
  });

  it("does NOT catch 'as unknown as ConcreteType'", () => {
    const lines = ["const x = null as unknown as Record<string, string>;"];
    expect(findAsAnyCasts(lines)).toHaveLength(0);
  });

  it("does NOT catch comment lines", () => {
    const lines = ["// avoid as any"];
    expect(findAsAnyCasts(lines)).toHaveLength(0);
  });

  it("does NOT catch string content", () => {
    const lines = ['const msg = "use as any carefully";'];
    expect(findAsAnyCasts(lines)).toHaveLength(0);
  });

  it("does NOT match function name asAny()", () => {
    const lines = ["asAny(value);"];
    expect(findAsAnyCasts(lines)).toHaveLength(0);
  });

  it("does NOT match word boundary (anyway)", () => {
    const lines = ["const isAnyway = true;"];
    expect(findAsAnyCasts(lines)).toHaveLength(0);
  });
});

// ─── findRelativeImports ────────────────────────────────────────────────────

describe("findRelativeImports", () => {
  it("catches parent-relative import with from", () => {
    const lines = ["import { foo } from '../core/bar';"];
    const v = findRelativeImports(lines);
    expect(v).toHaveLength(1);
    expect(v[0].category).toBe("relative-import");
  });

  it("catches current-dir import with from", () => {
    const lines = ["import { x } from './types';"];
    expect(findRelativeImports(lines)).toHaveLength(1);
  });

  it("catches import type with relative path", () => {
    const lines = ["import type { Foo } from '../types';"];
    expect(findRelativeImports(lines)).toHaveLength(1);
  });

  it("catches dynamic import with relative path", () => {
    const lines = ["const mod = await import('../utils');"];
    expect(findRelativeImports(lines)).toHaveLength(1);
  });

  it("catches require with relative path", () => {
    const lines = ["const fs = require('../adapters/fs');"];
    expect(findRelativeImports(lines)).toHaveLength(1);
  });

  it("does NOT catch non-relative package imports", () => {
    const lines = ["import { join } from 'path';"];
    expect(findRelativeImports(lines)).toHaveLength(0);
  });

  it("does NOT catch bun imports", () => {
    const lines = ["import { test } from 'bun:test';"];
    expect(findRelativeImports(lines)).toHaveLength(0);
  });

  it("does NOT catch aliased imports", () => {
    const lines = ["import { foo } from '@hooks/lib/utils';"];
    expect(findRelativeImports(lines)).toHaveLength(0);
  });

  it("does NOT catch comment lines", () => {
    const lines = ["// import { foo } from '../bar';"];
    expect(findRelativeImports(lines)).toHaveLength(0);
  });

  it("does NOT catch SvelteKit $-prefixed relative imports", () => {
    const lines = ["import type { PageData } from './$types';"];
    expect(findRelativeImports(lines)).toHaveLength(0);
  });
});

// ─── findAllViolations ──────────────────────────────────────────────────────

describe("findAllViolations", () => {
  it("combines all violation types", () => {
    const content = [
      "import { readFileSync } from 'fs';",
      "try { readFileSync('x'); } catch (e) {}",
      "const dir = process.env.HOME;",
      "type Foo = import('./types').Bar;",
      "const x = data as any;",
      "import { helper } from '../utils';",
    ].join("\n");

    const violations = findAllViolations(content);
    const categories = new Set(violations.map((v) => v.category));
    expect(categories.has("raw-import")).toBe(true);
    expect(categories.has("try-catch")).toBe(true);
    expect(categories.has("process-env")).toBe(true);
    expect(categories.has("inline-import-type")).toBe(true);
    expect(categories.has("as-any")).toBe(true);
    expect(categories.has("relative-import")).toBe(true);
  });

  it("returns empty for clean content", () => {
    const content = [
      "import { foo } from '@hooks/lib/utils';",
      "const x = JSON.parse(raw) as unknown as Config;",
      "export function add(a: number, b: number): number {",
      "  return a + b;",
      "}",
    ].join("\n");

    expect(findAllViolations(content)).toHaveLength(0);
  });
});

// ─── findDirectEnvAccess — defaultDeps exception ─────────────────────────────

describe("findDirectEnvAccess", () => {
  it("allows process.env in a const that feeds into defaultDeps", () => {
    const content = [
      "const baseDir = process.env.PAI_DIR || '~/.claude';",
      "",
      "const defaultDeps = { baseDir };",
    ].join("\n");
    const lines = content.split("\n");
    const violations = findDirectEnvAccess(content, lines);
    expect(violations).toHaveLength(0);
  });

  it("flags process.env in a const that does NOT feed into defaultDeps", () => {
    const content = [
      "const baseDir = process.env.PAI_DIR || '~/.claude';",
      "",
      "function doStuff() { return baseDir; }",
    ].join("\n");
    const lines = content.split("\n");
    const violations = findDirectEnvAccess(content, lines);
    expect(violations).toHaveLength(1);
    expect(violations[0].category).toBe("process-env");
  });
});

// ─── formatViolationSummary ──────────────────────────────────────────────────

describe("formatViolationSummary", () => {
  it("includes inline-import-type in summary", () => {
    const violations = [
      { line: 5, content: "type Foo = import('./types').Bar;", category: "inline-import-type", message: "Use import type" },
    ];
    const summary = formatViolationSummary(violations, "test.ts");
    expect(summary).toContain("1x inline import type");
  });

  it("includes all violation categories in summary", () => {
    const violations = [
      { line: 1, content: "import { readFileSync } from 'fs';", category: "raw-import", message: "m" },
      { line: 2, content: "try {} catch (e) {}", category: "try-catch", message: "m" },
      { line: 3, content: "const x = process.env.HOME;", category: "process-env", message: "m" },
      { line: 4, content: "type Foo = import('./t').Bar;", category: "inline-import-type", message: "m" },
      { line: 5, content: "const x = data as any;", category: "as-any", message: "m" },
      { line: 6, content: "import { x } from '../utils';", category: "relative-import", message: "m" },
      { line: 7, content: "export default function foo() {}", category: "export-default", message: "m" },
    ];
    const summary = formatViolationSummary(violations, "test.ts");
    expect(summary).toContain("raw Node builtin");
    expect(summary).toContain("try-catch flow control");
    expect(summary).toContain("process.env access");
    expect(summary).toContain("inline import type");
    expect(summary).toContain("unsafe type cast");
    expect(summary).toContain("relative import path");
    expect(summary).toContain("default export");
    expect(summary).toContain("7 violations");
  });
});
