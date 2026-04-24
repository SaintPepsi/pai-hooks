import { describe, expect, test } from "bun:test";
import type { Module } from "@swc/core";
import type { ParseDeps } from "./parse";
import { findTsFiles, parseDirectory, parseFile } from "./parse";

// ─── Mock Deps ──────────────────────────────────────────────────────────────

function createMockDeps(fs: Record<string, string | string[]>): ParseDeps {
  return {
    readFile: (path) => {
      const content = fs[path];
      return typeof content === "string" ? content : null;
    },
    readDir: (path) => {
      const content = fs[path];
      return Array.isArray(content) ? content : null;
    },
    isDirectory: (path) => Array.isArray(fs[path]),
    createHash: (content) => {
      let hash = 0;
      for (let i = 0; i < content.length; i++) {
        hash = (hash * 31 + content.charCodeAt(i)) >>> 0;
      }
      return hash.toString(16).padStart(16, "0");
    },
    parseTsSource: (source, isTsx): Module | null => {
      const result = Bun.spawnSync([
        "bun",
        "-e",
        `
        const { parseSync } = require("@swc/core");
        const source = ${JSON.stringify(source)};
        const result = parseSync(source, { syntax: "typescript", tsx: ${isTsx}, target: "es2022" });
        console.log(JSON.stringify(result));
      `,
      ]);
      if (result.exitCode !== 0) return null;
      const output = result.stdout.toString().trim();
      if (!output) return null;
      return JSON.parse(output) as Module;
    },
    join: (...parts) => parts.join("/"),
    resolve: (path) => (path.startsWith("/") ? path : `/root/${path}`),
  };
}

// ─── findTsFiles ────────────────────────────────────────────────────────────

describe("findTsFiles", () => {
  test("returns empty array for empty directory", () => {
    const deps = createMockDeps({
      "/root/src": [],
    });
    const result = findTsFiles("/root/src", deps);
    expect(result).toEqual([]);
  });

  test("finds .ts files in directory", () => {
    const deps = createMockDeps({
      "/root/src": ["foo.ts", "bar.ts"],
      "/root/src/foo.ts": "export const x = 1;",
      "/root/src/bar.ts": "export const y = 2;",
    });
    const result = findTsFiles("/root/src", deps);
    expect(result).toEqual(["/root/src/bar.ts", "/root/src/foo.ts"]);
  });

  test("excludes .d.ts files", () => {
    const deps = createMockDeps({
      "/root/src": ["types.d.ts", "code.ts"],
      "/root/src/types.d.ts": "declare module 'x';",
      "/root/src/code.ts": "export const x = 1;",
    });
    const result = findTsFiles("/root/src", deps);
    expect(result).toEqual(["/root/src/code.ts"]);
  });

  test("excludes node_modules directory", () => {
    const deps = createMockDeps({
      "/root/src": ["app.ts", "node_modules"],
      "/root/src/app.ts": "export const x = 1;",
      "/root/src/node_modules": ["dep.ts"],
      "/root/src/node_modules/dep.ts": "export const y = 2;",
    });
    const result = findTsFiles("/root/src", deps);
    expect(result).toEqual(["/root/src/app.ts"]);
  });

  test("excludes .git directory", () => {
    const deps = createMockDeps({
      "/root/src": ["app.ts", ".git"],
      "/root/src/app.ts": "export const x = 1;",
      "/root/src/.git": ["hooks.ts"],
      "/root/src/.git/hooks.ts": "export const y = 2;",
    });
    const result = findTsFiles("/root/src", deps);
    expect(result).toEqual(["/root/src/app.ts"]);
  });

  test("excludes structural-duplication-patterns directory", () => {
    const deps = createMockDeps({
      "/root/src": ["app.ts", "structural-duplication-patterns"],
      "/root/src/app.ts": "export const x = 1;",
      "/root/src/structural-duplication-patterns": ["examples"],
      "/root/src/structural-duplication-patterns/examples": ["pattern.ts"],
      "/root/src/structural-duplication-patterns/examples/pattern.ts": "export const y = 2;",
    });
    const result = findTsFiles("/root/src", deps);
    expect(result).toEqual(["/root/src/app.ts"]);
  });

  test("recurses into subdirectories", () => {
    const deps = createMockDeps({
      "/root/src": ["lib"],
      "/root/src/lib": ["utils.ts"],
      "/root/src/lib/utils.ts": "export const x = 1;",
    });
    const result = findTsFiles("/root/src", deps);
    expect(result).toEqual(["/root/src/lib/utils.ts"]);
  });

  test("ignores non-.ts files", () => {
    const deps = createMockDeps({
      "/root/src": ["app.ts", "readme.md", "config.json"],
      "/root/src/app.ts": "export const x = 1;",
    });
    const result = findTsFiles("/root/src", deps);
    expect(result).toEqual(["/root/src/app.ts"]);
  });

  test("returns sorted results", () => {
    const deps = createMockDeps({
      "/root/src": ["z.ts", "a.ts", "m.ts"],
      "/root/src/z.ts": "export const z = 1;",
      "/root/src/a.ts": "export const a = 1;",
      "/root/src/m.ts": "export const m = 1;",
    });
    const result = findTsFiles("/root/src", deps);
    expect(result).toEqual(["/root/src/a.ts", "/root/src/m.ts", "/root/src/z.ts"]);
  });

  test("handles null from readDir gracefully", () => {
    const deps = createMockDeps({});
    const result = findTsFiles("/nonexistent", deps);
    expect(result).toEqual([]);
  });
});

// ─── parseFile ──────────────────────────────────────────────────────────────

describe("parseFile", () => {
  test("returns null for non-existent file", () => {
    const deps = createMockDeps({});
    const result = parseFile("/nonexistent.ts", deps);
    expect(result).toBeNull();
  });

  test("returns null for unparseable content", () => {
    const deps = createMockDeps({
      "/root/bad.ts": "this is not valid {{ typescript",
    });
    const result = parseFile("/root/bad.ts", deps);
    expect(result).toBeNull();
  });

  test("parses file with no functions", () => {
    const deps = createMockDeps({
      "/root/constants.ts": "export const X = 1;\nexport const Y = 2;",
    });
    const result = parseFile("/root/constants.ts", deps);
    expect(result).not.toBeNull();
    expect(result!.path).toBe("/root/constants.ts");
    expect(result!.functions).toEqual([]);
  });

  test("extracts function declaration", () => {
    const deps = createMockDeps({
      "/root/utils.ts": "function add(a: number, b: number): number { return a + b; }",
    });
    const result = parseFile("/root/utils.ts", deps);
    expect(result).not.toBeNull();
    expect(result!.functions).toHaveLength(1);
    expect(result!.functions[0].name).toBe("add");
    expect(result!.functions[0].line).toBe(1);
  });

  test("extracts exported function", () => {
    const deps = createMockDeps({
      "/root/utils.ts": "export function multiply(x: number, y: number): number { return x * y; }",
    });
    const result = parseFile("/root/utils.ts", deps);
    expect(result).not.toBeNull();
    expect(result!.functions).toHaveLength(1);
    expect(result!.functions[0].name).toBe("multiply");
  });

  test("extracts arrow function", () => {
    const deps = createMockDeps({
      "/root/utils.ts": "const greet = (name: string): string => { return `Hello, ${name}`; };",
    });
    const result = parseFile("/root/utils.ts", deps);
    expect(result).not.toBeNull();
    expect(result!.functions).toHaveLength(1);
    expect(result!.functions[0].name).toBe("greet");
  });

  test("extracts exported arrow function", () => {
    const deps = createMockDeps({
      "/root/utils.ts": "export const double = (n: number): number => { return n * 2; };",
    });
    const result = parseFile("/root/utils.ts", deps);
    expect(result).not.toBeNull();
    expect(result!.functions).toHaveLength(1);
    expect(result!.functions[0].name).toBe("double");
  });

  test("extracts multiple functions", () => {
    const deps = createMockDeps({
      "/root/math.ts": `
        function add(a: number, b: number): number { return a + b; }
        function sub(a: number, b: number): number { return a - b; }
        const mul = (a: number, b: number): number => { return a * b; };
      `,
    });
    const result = parseFile("/root/math.ts", deps);
    expect(result).not.toBeNull();
    expect(result!.functions).toHaveLength(3);
    expect(result!.functions.map((f) => f.name).sort()).toEqual(["add", "mul", "sub"]);
  });

  test("extracts imports", () => {
    const deps = createMockDeps({
      "/root/app.ts": `
        import { foo } from "./foo";
        import { bar } from "./bar";
        function test(): void { console.log(foo, bar); }
      `,
    });
    const result = parseFile("/root/app.ts", deps);
    expect(result).not.toBeNull();
    expect(result!.imports).toEqual(["./bar", "./foo"]);
  });

  test("extracts param types", () => {
    const deps = createMockDeps({
      "/root/utils.ts": "function process(input: string, count: number): void { }",
    });
    const result = parseFile("/root/utils.ts", deps);
    expect(result).not.toBeNull();
    expect(result!.functions[0].params).toHaveLength(2);
    expect(result!.functions[0].params[0].typeAnnotation).toBe("TsKeywordType");
    expect(result!.functions[0].params[1].typeAnnotation).toBe("TsKeywordType");
  });

  test("extracts return type", () => {
    const deps = createMockDeps({
      "/root/utils.ts": "function getName(): string { return 'test'; }",
    });
    const result = parseFile("/root/utils.ts", deps);
    expect(result).not.toBeNull();
    expect(result!.functions[0].returnType).toBe("TsKeywordType");
  });

  test("generates body hash", () => {
    const deps = createMockDeps({
      "/root/a.ts": "function foo(): void { console.log('a'); }",
      "/root/b.ts": "function bar(): void { console.log('b'); }",
    });
    const resultA = parseFile("/root/a.ts", deps);
    const resultB = parseFile("/root/b.ts", deps);
    expect(resultA!.functions[0].bodyHash).toBeDefined();
    expect(resultB!.functions[0].bodyHash).toBeDefined();
    // Same structure, different literals → same hash (normalized)
    expect(resultA!.functions[0].bodyHash).toBe(resultB!.functions[0].bodyHash);
  });

  test("collects body node types", () => {
    const deps = createMockDeps({
      "/root/utils.ts": "function test(): number { const x = 1; return x + 2; }",
    });
    const result = parseFile("/root/utils.ts", deps);
    expect(result).not.toBeNull();
    expect(result!.functions[0].bodyNodeTypes.length).toBeGreaterThan(0);
    expect(result!.functions[0].bodyNodeTypes).toContain("ReturnStatement");
  });

  test("tracks correct line numbers for multiple functions", () => {
    const deps = createMockDeps({
      "/root/utils.ts": `function a(): void { }
function b(): void { }
function c(): void { }`,
    });
    const result = parseFile("/root/utils.ts", deps);
    expect(result).not.toBeNull();
    expect(result!.functions[0].line).toBe(1);
    expect(result!.functions[1].line).toBe(2);
    expect(result!.functions[2].line).toBe(3);
  });
});

// ─── parseDirectory ─────────────────────────────────────────────────────────

describe("parseDirectory", () => {
  test("returns empty array for empty directory", () => {
    const deps = createMockDeps({
      "/root/src": [],
    });
    const result = parseDirectory("/root/src", deps);
    expect(result).toEqual([]);
  });

  test("parses all .ts files with functions", () => {
    const deps = createMockDeps({
      "/root/src": ["a.ts", "b.ts"],
      "/root/src/a.ts": "function foo(): void { }",
      "/root/src/b.ts": "function bar(): void { }",
    });
    const result = parseDirectory("/root/src", deps);
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.path).sort()).toEqual(["/root/src/a.ts", "/root/src/b.ts"]);
  });

  test("skips files with no functions", () => {
    const deps = createMockDeps({
      "/root/src": ["funcs.ts", "consts.ts"],
      "/root/src/funcs.ts": "function test(): void { }",
      "/root/src/consts.ts": "export const X = 1;",
    });
    const result = parseDirectory("/root/src", deps);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("/root/src/funcs.ts");
  });

  test("skips unparseable files", () => {
    const deps = createMockDeps({
      "/root/src": ["good.ts", "bad.ts"],
      "/root/src/good.ts": "function test(): void { }",
      "/root/src/bad.ts": "invalid {{ syntax",
    });
    const result = parseDirectory("/root/src", deps);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("/root/src/good.ts");
  });

  test("respects directory exclusions", () => {
    const deps = createMockDeps({
      "/root/src": ["app.ts", "node_modules", "structural-duplication-patterns"],
      "/root/src/app.ts": "function main(): void { }",
      "/root/src/node_modules": ["dep.ts"],
      "/root/src/node_modules/dep.ts": "function dep(): void { }",
      "/root/src/structural-duplication-patterns": ["example.ts"],
      "/root/src/structural-duplication-patterns/example.ts": "function pattern(): void { }",
    });
    const result = parseDirectory("/root/src", deps);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("/root/src/app.ts");
  });
});

// ─── Integration with real filesystem ───────────────────────────────────────

describe("integration", () => {
  test("parses this test file", () => {
    const result = parseFile(import.meta.path);
    expect(result).not.toBeNull();
    expect(result!.path).toBe(import.meta.path);
    expect(result!.functions.length).toBeGreaterThan(0);
  });

  test("finds .ts files in research directory", () => {
    const files = findTsFiles(import.meta.dir);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.endsWith(".ts"))).toBe(true);
    expect(files.every((f) => !f.endsWith(".d.ts"))).toBe(true);
  });
});
