import { describe, it, expect } from "bun:test";
import {
  stripCommentsAndStrings,
  detectAnyOnLine,
  findAnyViolations,
  TypeStrictness,
  type TypeStrictnessDeps,
} from "./TypeStrictness";
import { type ToolHookInput } from "../core/types/hook-inputs";

// ─── Helper ──────────────────────────────────────────────────────────────────

const noop = () => {};
const mockSignal = {
  appendFile: () => ({ ok: true, value: undefined }) as const,
  ensureDir: () => ({ ok: true, value: undefined }) as const,
  baseDir: "/tmp/test",
};
const deps: TypeStrictnessDeps = { signal: mockSignal, stderr: noop };

function makeInput(overrides: Partial<ToolHookInput> = {}): ToolHookInput {
  return {
    session_id: "test-session",
    tool_name: "Edit",
    tool_input: {
      file_path: "/project/src/utils.ts",
      new_string: "const x: string = 'hello';",
    },
    ...overrides,
  };
}

// ─── stripCommentsAndStrings ─────────────────────────────────────────────────

describe("stripCommentsAndStrings", () => {
  it("strips single-line comments", () => {
    const result = stripCommentsAndStrings("const x: any; // any type here");
    expect(result).toContain("const x: any;");
    expect(result).not.toContain("any type here");
  });

  it("strips multi-line comments", () => {
    const result = stripCommentsAndStrings("/* any */ const x: string;");
    expect(result).not.toMatch(/any/);
    expect(result).toContain("const x: string;");
  });

  it("strips double-quoted strings", () => {
    const result = stripCommentsAndStrings('const msg = "any value";');
    expect(result).not.toMatch(/any value/);
  });

  it("strips single-quoted strings", () => {
    const result = stripCommentsAndStrings("const msg = 'any value';");
    expect(result).not.toMatch(/any value/);
  });

  it("strips template literals", () => {
    const result = stripCommentsAndStrings("const msg = `any value`;");
    expect(result).not.toMatch(/any value/);
  });

  it("preserves line count for accurate line numbers", () => {
    const input = "line1\n/* multi\nline\ncomment */\nline5";
    const result = stripCommentsAndStrings(input);
    expect(result.split("\n").length).toBe(input.split("\n").length);
  });
});

// ─── detectAnyOnLine (true positives) ────────────────────────────────────────

describe("detectAnyOnLine — true positives", () => {
  const cases: Array<[string, string]> = [
    ["const x: any = 5;", "type annotation"],
    ["function foo(x: any): void {}", "type annotation"],
    ["  bar: any;", "type annotation"],
    ["return val as any;", "type assertion"],
    ["(x as any).method()", "type assertion"],
    ["Promise<any>", "generic parameter"],
    ["Record<string, any>", "generic parameter"],
    ["Map<string, any>", "generic parameter"],
    ["Array<any>", "generic parameter"],
    ["const arr: any[] = [];", "array type"],
    ["type X = string | any;", "union"],
    ["type Y = any | string;", "union"],
    ["type Z = any & Foo;", "intersection"],
    ["type W = Foo & any;", "intersection"],
  ];

  for (const [line, _expectedPattern] of cases) {
    it(`detects: ${line}`, () => {
      const result = detectAnyOnLine(line);
      expect(result.found).toBe(true);
    });
  }
});

// ─── detectAnyOnLine (false positives — must NOT trigger) ────────────────────

describe("detectAnyOnLine — false positives", () => {
  const safeLines: string[] = [
    "const anyMatch = true;",
    "const isAny = false;",
    "if (anyValue > 0) {",
    "const company = 'Acme';",
    "const manyItems = [];",
    'console.log("any");',
    "// any type here",
    "type AnyHandler = () => void;",
    "interface AnyConfig { name: string }",
    "const hasAnyFlag = true;",
    "function handleAnyEvent() {}",
    "const notAnyMore = false;",
    "export class AnyParser {}",
    "const tooManyRequests = 429;",
  ];

  for (const line of safeLines) {
    it(`ignores: ${line}`, () => {
      const result = detectAnyOnLine(line);
      expect(result.found).toBe(false);
    });
  }
});

// ─── findAnyViolations ──────────────────────────────────────────────────────

describe("findAnyViolations", () => {
  it("finds violations with correct line numbers", () => {
    const code = `import { ok } from "./result";

function process(data: any): void {
  const items: any[] = [];
  console.log("hello");
}`;
    const violations = findAnyViolations(code);
    expect(violations.length).toBe(2);
    expect(violations[0].line).toBe(3);
    expect(violations[1].line).toBe(4);
  });

  it("ignores any in comments", () => {
    const code = `// This function accepts any input
function process(data: unknown): void {
  /* any type would be bad here */
  const x: string = "hello";
}`;
    const violations = findAnyViolations(code);
    expect(violations.length).toBe(0);
  });

  it("ignores any in strings", () => {
    const code = `const msg = "accepts any input";
const template = \`any value\`;
const single = 'any type';`;
    const violations = findAnyViolations(code);
    expect(violations.length).toBe(0);
  });

  it("returns empty for clean TypeScript", () => {
    const code = `export function validate(input: unknown): input is string {
  return typeof input === "string";
}
const items: string[] = [];
const record: Record<string, number> = {};`;
    const violations = findAnyViolations(code);
    expect(violations.length).toBe(0);
  });

  it("catches multiple patterns in one file", () => {
    const code = `const x: any = 5;
const y = x as any;
const arr: any[] = [];
type T = Promise<any>;`;
    const violations = findAnyViolations(code);
    expect(violations.length).toBe(4);
  });
});

// ─── Contract: accepts ──────────────────────────────────────────────────────

describe("TypeStrictness.accepts", () => {
  it("accepts Edit on .ts files", () => {
    expect(TypeStrictness.accepts(makeInput({ tool_name: "Edit", tool_input: { file_path: "/src/foo.ts", new_string: "" } }))).toBe(true);
  });

  it("accepts Write on .tsx files", () => {
    expect(TypeStrictness.accepts(makeInput({ tool_name: "Write", tool_input: { file_path: "/src/App.tsx", content: "" } }))).toBe(true);
  });

  it("rejects Edit on .js files", () => {
    expect(TypeStrictness.accepts(makeInput({ tool_name: "Edit", tool_input: { file_path: "/src/foo.js", new_string: "" } }))).toBe(false);
  });

  it("rejects Edit on .py files", () => {
    expect(TypeStrictness.accepts(makeInput({ tool_name: "Edit", tool_input: { file_path: "/src/foo.py", new_string: "" } }))).toBe(false);
  });

  it("rejects Edit on .md files", () => {
    expect(TypeStrictness.accepts(makeInput({ tool_name: "Edit", tool_input: { file_path: "/docs/README.md", new_string: "" } }))).toBe(false);
  });

  it("rejects Read tool", () => {
    expect(TypeStrictness.accepts(makeInput({ tool_name: "Read", tool_input: { file_path: "/src/foo.ts" } }))).toBe(false);
  });

  it("rejects Bash tool", () => {
    expect(TypeStrictness.accepts(makeInput({ tool_name: "Bash", tool_input: { command: "echo any" } }))).toBe(false);
  });
});

// ─── Contract: execute ──────────────────────────────────────────────────────

describe("TypeStrictness.execute", () => {
  it("blocks Edit with any type annotation", () => {
    const input = makeInput({
      tool_input: { file_path: "/src/foo.ts", new_string: "const x: any = 5;" },
    });
    const result = TypeStrictness.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("block");
      if (result.value.type === "block") {
        expect(result.value.reason).toContain("any");
        expect(result.value.reason).toContain("Line 1");
      }
    }
  });

  it("blocks Write with any in content", () => {
    const input = makeInput({
      tool_name: "Write",
      tool_input: {
        file_path: "/src/foo.ts",
        content: "export function parse(input: any): string { return String(input); }",
      },
    });
    const result = TypeStrictness.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("block");
    }
  });

  it("continues for clean TypeScript", () => {
    const input = makeInput({
      tool_input: { file_path: "/src/foo.ts", new_string: "const x: string = 'hello';" },
    });
    const result = TypeStrictness.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
    }
  });

  it("continues when new_string is absent", () => {
    const input = makeInput({
      tool_input: { file_path: "/src/foo.ts" },
    });
    const result = TypeStrictness.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
    }
  });

  it("block message includes fix guidance", () => {
    const input = makeInput({
      tool_input: { file_path: "/src/foo.ts", new_string: "const x: any = 5;" },
    });
    const result = TypeStrictness.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === "block") {
      expect(result.value.reason).toContain("unknown");
      expect(result.value.reason).toContain("Fix:");
    }
  });

  it("does not trigger on any in comments within new_string", () => {
    const input = makeInput({
      tool_input: {
        file_path: "/src/foo.ts",
        new_string: "// any type is bad\nconst x: string = 'hello';",
      },
    });
    const result = TypeStrictness.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
    }
  });
});
