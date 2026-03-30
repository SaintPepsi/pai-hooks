import { describe, expect, it } from "bun:test";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  detectAnyOnLine,
  findAnyViolations,
  findLazyUnknownUsage,
  stripCommentsAndStrings,
  TypeStrictness,
  type TypeStrictnessDeps,
} from "@hooks/hooks/CodingStandards/TypeStrictness/TypeStrictness.contract";

// ─── Helper ──────────────────────────────────────────────────────────────────

// Build strings containing the forbidden keyword without triggering hooks
// on THIS file's source text.
const ANY_KW = "an" + "y";
const COLON_ANY = `: ${ANY_KW}`;
const AS_ANY = `as ${ANY_KW}`;
const ANY_ARR = `${ANY_KW}[]`;

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
    const result = stripCommentsAndStrings(`const x${COLON_ANY}; // ${ANY_KW} type here`);
    expect(result).toContain(`const x${COLON_ANY};`);
    expect(result).not.toContain(`${ANY_KW} type here`);
  });

  it("strips multi-line comments", () => {
    const result = stripCommentsAndStrings(`/* ${ANY_KW} */ const x: string;`);
    expect(result).toContain("const x: string;");
  });

  it("strips double-quoted strings", () => {
    const result = stripCommentsAndStrings(`const msg = "${ANY_KW} value";`);
    expect(result).not.toMatch(new RegExp(`${ANY_KW} value`));
  });

  it("strips single-quoted strings", () => {
    const result = stripCommentsAndStrings(`const msg = '${ANY_KW} value';`);
    expect(result).not.toMatch(new RegExp(`${ANY_KW} value`));
  });

  it("strips template literals", () => {
    const result = stripCommentsAndStrings(`const msg = \`${ANY_KW} value\`;`);
    expect(result).not.toMatch(new RegExp(`${ANY_KW} value`));
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
    [`const x${COLON_ANY} = 5;`, "type annotation"],
    [`function foo(x${COLON_ANY}): void {}`, "type annotation"],
    [`  bar${COLON_ANY};`, "type annotation"],
    [`return val ${AS_ANY};`, "type assertion"],
    [`(x ${AS_ANY}).method()`, "type assertion"],
    [`Promise<${ANY_KW}>`, "generic parameter"],
    [`Record<string, ${ANY_KW}>`, "generic parameter"],
    [`Map<string, ${ANY_KW}>`, "generic parameter"],
    [`Array<${ANY_KW}>`, "generic parameter"],
    [`const arr: ${ANY_ARR} = [];`, "array type"],
    [`type X = string | ${ANY_KW};`, "union"],
    [`type Y = ${ANY_KW} | string;`, "union"],
    [`type Z = ${ANY_KW} & Foo;`, "intersection"],
    [`type W = Foo & ${ANY_KW};`, "intersection"],
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
    "const matchFlag = true;",
    "const isSet = false;",
    "if (value > 0) {",
    "const company = 'Acme';",
    "const manyItems = [];",
    'console.log("something");',
    "// comment here",
    "type SomeHandler = () => void;",
    "interface SomeConfig { name: string }",
    "const hasFlag = true;",
    "function handleEvent() {}",
    "const notMore = false;",
    "export class Parser {}",
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
    const code = [
      'import { ok } from "@hooks/core/result";',
      "",
      `function process(data${COLON_ANY}): void {`,
      `  const items: ${ANY_ARR} = [];`,
      '  console.log("hello");',
      "}",
    ].join("\n");
    const violations = findAnyViolations(code);
    expect(violations.length).toBe(2);
    expect(violations[0].line).toBe(3);
    expect(violations[1].line).toBe(4);
  });

  it("ignores content in comments", () => {
    const code = [
      `// This function accepts ${ANY_KW} input`,
      "function process(data: unknown): void {",
      `  /* ${ANY_KW} type would be bad here */`,
      '  const x: string = "hello";',
      "}",
    ].join("\n");
    const violations = findAnyViolations(code);
    expect(violations.length).toBe(0);
  });

  it("ignores content in strings", () => {
    const code = [
      `const msg = "accepts ${ANY_KW} input";`,
      `const template = \`${ANY_KW} value\`;`,
      `const single = '${ANY_KW} type';`,
    ].join("\n");
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
    const code = [
      `const x${COLON_ANY} = 5;`,
      `const y = x ${AS_ANY};`,
      `const arr: ${ANY_ARR} = [];`,
      `type T = Promise<${ANY_KW}>;`,
    ].join("\n");
    const violations = findAnyViolations(code);
    expect(violations.length).toBe(4);
  });
});

// ─── Contract: accepts ──────────────────────────────────────────────────────

describe("TypeStrictness.accepts", () => {
  it("accepts Edit on .ts files", () => {
    expect(
      TypeStrictness.accepts(
        makeInput({ tool_name: "Edit", tool_input: { file_path: "/src/foo.ts", new_string: "" } }),
      ),
    ).toBe(true);
  });

  it("accepts Write on .tsx files", () => {
    expect(
      TypeStrictness.accepts(
        makeInput({ tool_name: "Write", tool_input: { file_path: "/src/App.tsx", content: "" } }),
      ),
    ).toBe(true);
  });

  it("rejects Edit on .js files", () => {
    expect(
      TypeStrictness.accepts(
        makeInput({ tool_name: "Edit", tool_input: { file_path: "/src/foo.js", new_string: "" } }),
      ),
    ).toBe(false);
  });

  it("rejects Edit on .py files", () => {
    expect(
      TypeStrictness.accepts(
        makeInput({ tool_name: "Edit", tool_input: { file_path: "/src/foo.py", new_string: "" } }),
      ),
    ).toBe(false);
  });

  it("rejects Edit on .md files", () => {
    expect(
      TypeStrictness.accepts(
        makeInput({
          tool_name: "Edit",
          tool_input: { file_path: "/docs/README.md", new_string: "" },
        }),
      ),
    ).toBe(false);
  });

  it("rejects Read tool", () => {
    expect(
      TypeStrictness.accepts(
        makeInput({ tool_name: "Read", tool_input: { file_path: "/src/foo.ts" } }),
      ),
    ).toBe(false);
  });

  it("rejects Bash tool", () => {
    expect(
      TypeStrictness.accepts(
        makeInput({ tool_name: "Bash", tool_input: { command: "echo test" } }),
      ),
    ).toBe(false);
  });

  it("rejects when file_path is missing from tool_input", () => {
    expect(
      TypeStrictness.accepts(makeInput({ tool_name: "Edit", tool_input: { new_string: "code" } })),
    ).toBe(false);
  });

  it("rejects when tool_input is a string", () => {
    expect(
      TypeStrictness.accepts(
        makeInput({
          tool_name: "Edit",
          tool_input: "/src/foo.ts" as unknown as Record<string, unknown>,
        }),
      ),
    ).toBe(false);
  });
});

// ─── Contract: execute ──────────────────────────────────────────────────────

describe("TypeStrictness.execute", () => {
  it("blocks Edit with type annotation violation", () => {
    const input = makeInput({
      tool_input: { file_path: "/src/foo.ts", new_string: `const x${COLON_ANY} = 5;` },
    });
    const result = TypeStrictness.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("block");
      if (result.value.type === "block") {
        expect(result.value.reason).toContain("Line 1");
      }
    }
  });

  it("blocks Write with violations in content", () => {
    const input = makeInput({
      tool_name: "Write",
      tool_input: {
        file_path: "/src/foo.ts",
        content: `export function parse(input${COLON_ANY}): string { return String(input); }`,
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

  it("continues when tool_input is a string (no content to extract)", () => {
    const input: ToolHookInput = {
      session_id: "test-session",
      tool_name: "Edit",
      tool_input: "/src/foo.ts" as unknown as Record<string, unknown>,
    };
    const result = TypeStrictness.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
    }
  });

  it("block message includes constructive type guidance", () => {
    const input = makeInput({
      tool_input: { file_path: "/src/foo.ts", new_string: `const x${COLON_ANY} = 5;` },
    });
    const result = TypeStrictness.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === "block") {
      expect(result.value.reason).toContain("STOP");
      expect(result.value.reason).toContain("READ the type definitions");
      expect(result.value.reason).toContain("Type correctness > speed");
    }
  });

  it("does not trigger on content in comments within new_string", () => {
    const input = makeInput({
      tool_input: {
        file_path: "/src/foo.ts",
        new_string: `// ${ANY_KW} type is bad\nconst x: string = 'hello';`,
      },
    });
    const result = TypeStrictness.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
    }
  });

  it("injects lazy-unknown advisory when bare unknown is found", () => {
    const input = makeInput({
      tool_input: {
        file_path: "/src/foo.ts",
        new_string: "function process(data: unknown): void {\n  console.log(data);\n}",
      },
    });
    const result = TypeStrictness.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
      expect((result.value as { additionalContext?: string }).additionalContext).toContain(
        "LAZY TYPE WARNING",
      );
    }
  });
});

// ─── findLazyUnknownUsage ───────────────────────────────────────────────────

describe("findLazyUnknownUsage", () => {
  it("flags bare : unknown annotation", () => {
    const code = "function process(data: unknown): void {}";
    const warnings = findLazyUnknownUsage(code);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].pattern).toContain(": unknown");
  });

  it("flags bare as unknown assertion", () => {
    const code = "const x = value as unknown;";
    const warnings = findLazyUnknownUsage(code);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("flags bare unknown[] array", () => {
    const code = "const items: unknown[] = [];";
    const warnings = findLazyUnknownUsage(code);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("exempts catch (e: unknown)", () => {
    const code = "catch (e: unknown) {\n  console.error(e);\n}";
    const warnings = findLazyUnknownUsage(code);
    expect(warnings.length).toBe(0);
  });

  it("exempts catch (e) without annotation", () => {
    const code = "catch (e) {\n  console.error(e);\n}";
    const warnings = findLazyUnknownUsage(code);
    expect(warnings.length).toBe(0);
  });

  it("exempts JSON.parse result", () => {
    const code = "const data: unknown = JSON.parse(raw);";
    const warnings = findLazyUnknownUsage(code);
    expect(warnings.length).toBe(0);
  });

  it("exempts Record<string, unknown>", () => {
    const code = "const obj: Record<string, unknown> = {};";
    const warnings = findLazyUnknownUsage(code);
    expect(warnings.length).toBe(0);
  });

  it("exempts Promise<unknown>", () => {
    const code = "async function fetch(): Promise<unknown> {}";
    const warnings = findLazyUnknownUsage(code);
    expect(warnings.length).toBe(0);
  });

  it("exempts type guard parameters", () => {
    const code = "function isString(value: unknown): value is string {}";
    const warnings = findLazyUnknownUsage(code);
    expect(warnings.length).toBe(0);
  });

  it("ignores unknown in comments", () => {
    const code = "// const x: unknown = 5;\nconst x: string = 'hello';";
    const warnings = findLazyUnknownUsage(code);
    expect(warnings.length).toBe(0);
  });

  it("ignores unknown in string literals", () => {
    const code = 'const msg = "type unknown is not allowed";';
    const warnings = findLazyUnknownUsage(code);
    expect(warnings.length).toBe(0);
  });
});

// ─── getToolContent edge cases ──────────────────────────────────────────────

describe("TypeStrictness.execute — tool content extraction", () => {
  it("extracts content from Edit tool new_string", () => {
    const input = makeInput({
      tool_name: "Edit",
      tool_input: {
        file_path: "/project/src/utils.ts",
        new_string: `const x${COLON_ANY};`,
      },
    });
    const result = TypeStrictness.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("block");
  });

  it("continues for non-Write/non-Edit tools", () => {
    const input = makeInput({
      tool_name: "Read",
      tool_input: { file_path: "/project/src/utils.ts" },
    });
    const result = TypeStrictness.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });
});

// ─── Svelte file handling ───────────────────────────────────────────────────

describe("TypeStrictness.execute — Svelte files", () => {
  it("scans script block from .svelte file", () => {
    const svelteContent = [
      '<script lang="ts">',
      `const x${COLON_ANY} = "hello";`,
      "</script>",
      "<div>hello</div>",
    ].join("\n");
    const input = makeInput({
      tool_name: "Write",
      tool_input: { file_path: "/project/src/Component.svelte", content: svelteContent },
    });
    const result = TypeStrictness.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("block");
  });

  it("continues when .svelte file has no script block", () => {
    const input = makeInput({
      tool_name: "Write",
      tool_input: { file_path: "/project/src/NoScript.svelte", content: "<div>Just HTML</div>" },
    });
    const result = TypeStrictness.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });
});
