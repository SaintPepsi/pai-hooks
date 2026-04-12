import { beforeEach, describe, expect, test } from "bun:test";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { TypeCheckVerifierDeps } from "@hooks/hooks/CodingStandards/TypeCheckVerifier/TypeCheckVerifier.contract";
import {
  _resetDebounceCache,
  discoverTypeCheck,
  parseTypeErrors,
  TypeCheckVerifier,
} from "@hooks/hooks/CodingStandards/TypeCheckVerifier/TypeCheckVerifier.contract";
import { getPostToolUseAdvisory as getAdvisory } from "@hooks/hooks/CodingStandards/test-helpers";

// ─── Discovery Tests ────────────────────────────────────────────────────────

describe("discoverTypeCheck", () => {
  beforeEach(() => {
    _resetDebounceCache();
  });

  test("discovers svelte-check from package.json check script", () => {
    const deps = {
      fileExists: (p: string) => p === "/project/package.json",
      readFile: (p: string) =>
        p === "/project/package.json"
          ? '{"scripts":{"check":"svelte-kit sync && svelte-check --tsconfig ./tsconfig.json"}}'
          : null,
    };

    const result = discoverTypeCheck("/project/src/Component.svelte", deps);
    expect(result).not.toBeNull();
    expect(result!.cwd).toBe("/project");
    expect(result!.args).toContain("svelte-check");
  });

  test("discovers typecheck script as fallback", () => {
    const deps = {
      fileExists: (p: string) => p === "/project/package.json",
      readFile: (p: string) =>
        p === "/project/package.json" ? '{"scripts":{"typecheck":"vue-tsc --noEmit"}}' : null,
    };

    const result = discoverTypeCheck("/project/src/file.ts", deps);
    expect(result).not.toBeNull();
    expect(result!.args).toContain("vue-tsc");
  });

  test("falls back to tsc --noEmit with tsconfig.json", () => {
    const deps = {
      fileExists: (p: string) => p === "/project/package.json" || p === "/project/tsconfig.json",
      readFile: (p: string) =>
        p === "/project/package.json" ? '{"scripts":{"dev":"vite"}}' : null,
    };

    const result = discoverTypeCheck("/project/src/file.ts", deps);
    expect(result).not.toBeNull();
    expect(result!.cmd).toBe("npx");
    expect(result!.args).toEqual(["tsc", "--noEmit"]);
  });

  test("returns null for projects without type checking", () => {
    const deps = {
      fileExists: (p: string) => p === "/project/package.json",
      readFile: (p: string) =>
        p === "/project/package.json" ? '{"scripts":{"dev":"node server.js"}}' : null,
    };

    const result = discoverTypeCheck("/project/src/file.ts", deps);
    expect(result).toBeNull();
  });

  test("walks up directory tree to find package.json", () => {
    const deps = {
      fileExists: (p: string) => p === "/project/package.json",
      readFile: (p: string) =>
        p === "/project/package.json" ? '{"scripts":{"check":"tsc --noEmit"}}' : null,
    };

    const result = discoverTypeCheck("/project/src/deep/nested/file.ts", deps);
    expect(result).not.toBeNull();
    expect(result!.cwd).toBe("/project");
  });
});

// ─── Output Parsing Tests ───────────────────────────────────────────────────

describe("parseTypeErrors", () => {
  test("parses tsc error format", () => {
    const output = `src/file.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/other.ts(3,1): error TS2304: Cannot find name 'foo'.`;

    const errors = parseTypeErrors(output, "src/file.ts");
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(10);
    expect(errors[0].col).toBe(5);
    expect(errors[0].message).toContain("not assignable");
  });

  test("parses svelte-check error format", () => {
    const output = `1773527282972 ERROR "src/routes/+layout.svelte" 66:32 "Object literal may only specify known properties"
1773527282972 WARNING "src/lib/Gallery.svelte" 179:3 "Unused CSS selector"`;

    const errors = parseTypeErrors(output, "src/routes/+layout.svelte");
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(66);
    expect(errors[0].col).toBe(32);
    expect(errors[0].message).toContain("Object literal");
  });

  test("filters to only target file", () => {
    const output = `src/a.ts(1,1): error TS2304: err a
src/b.ts(2,2): error TS2304: err b
src/a.ts(3,3): error TS2304: err a2`;

    const errors = parseTypeErrors(output, "src/a.ts");
    expect(errors).toHaveLength(2);
  });

  test("returns empty for clean output", () => {
    const errors = parseTypeErrors("", "src/file.ts");
    expect(errors).toHaveLength(0);
  });

  test("handles multiline svelte-check error messages with escaped newlines", () => {
    const output = `1773527282972 ERROR "src/lib/components/Foo.svelte" 203:38 "Argument of type 'X | null' is not assignable to parameter of type 'X'.\\n  Type 'null' is not assignable to type 'X'."`;

    const errors = parseTypeErrors(output, "src/lib/components/Foo.svelte");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("not assignable");
  });
});

// ─── Contract Tests ─────────────────────────────────────────────────────────

describe("TypeCheckVerifier contract", () => {
  beforeEach(() => {
    _resetDebounceCache();
  });

  function makeInput(toolName: string, filePath: string): ToolHookInput {
    return {
      tool_name: toolName,
      tool_input: { file_path: filePath },
      session_id: "test-session",
    } as ToolHookInput;
  }

  test("accepts Edit on .ts files", () => {
    expect(TypeCheckVerifier.accepts(makeInput("Edit", "/project/src/file.ts"))).toBe(true);
  });

  test("accepts Write on .svelte files", () => {
    expect(TypeCheckVerifier.accepts(makeInput("Write", "/project/src/Component.svelte"))).toBe(
      true,
    );
  });

  test("rejects non-Edit/Write tools", () => {
    expect(TypeCheckVerifier.accepts(makeInput("Read", "/project/src/file.ts"))).toBe(false);
  });

  test("rejects non-TypeScript files", () => {
    expect(TypeCheckVerifier.accepts(makeInput("Edit", "/project/src/style.css"))).toBe(false);
  });

  test("returns continue when no type checker found", () => {
    const deps: TypeCheckVerifierDeps = {
      fileExists: () => false,
      readFile: () => null,
      execWithTimeout: () => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
        timedOut: false,
      }),
      signal: {
        baseDir: "/tmp",
        ensureDir: () => ({ ok: true, value: undefined }) as const,
        appendFile: () => ({ ok: true, value: undefined }) as const,
      },
      stderr: () => {},
    };

    const result = TypeCheckVerifier.execute(makeInput("Edit", "/project/src/file.ts"), deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.continue).toBe(true);
  });

  test("returns advisory context when type errors found", () => {
    const deps: TypeCheckVerifierDeps = {
      fileExists: (p: string) => p === "/project/package.json" || p === "/project/tsconfig.json",
      readFile: (p: string) =>
        p === "/project/package.json" ? '{"scripts":{"dev":"vite"}}' : null,
      execWithTimeout: () => ({
        stdout:
          "/project/src/file.ts(5,3): error TS2322: Type 'string' is not assignable to type 'number'.",
        stderr: "",
        exitCode: 1,
        timedOut: false,
      }),
      signal: {
        baseDir: "/tmp",
        ensureDir: () => ({ ok: true, value: undefined }) as const,
        appendFile: () => ({ ok: true, value: undefined }) as const,
      },
      stderr: () => {},
    };

    const result = TypeCheckVerifier.execute(makeInput("Edit", "/project/src/file.ts"), deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.continue).toBe(true);
      const advisory = getAdvisory(result.value) ?? "";
      expect(advisory).toContain("TYPE ERRORS");
      expect(advisory).toContain("not assignable");
    }
  });

  test("returns clean continue when no errors for target file", () => {
    const deps: TypeCheckVerifierDeps = {
      fileExists: (p: string) => p === "/project/package.json" || p === "/project/tsconfig.json",
      readFile: (p: string) =>
        p === "/project/package.json" ? '{"scripts":{"dev":"vite"}}' : null,
      execWithTimeout: () => ({
        stdout: "/project/src/other.ts(1,1): error TS2304: err",
        stderr: "",
        exitCode: 1,
        timedOut: false,
      }),
      signal: {
        baseDir: "/tmp",
        ensureDir: () => ({ ok: true, value: undefined }) as const,
        appendFile: () => ({ ok: true, value: undefined }) as const,
      },
      stderr: () => {},
    };

    const result = TypeCheckVerifier.execute(makeInput("Edit", "/project/src/file.ts"), deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.continue).toBe(true);
      expect(getAdvisory(result.value)).toBeUndefined();
    }
  });

  test("handles timeout gracefully", () => {
    const deps: TypeCheckVerifierDeps = {
      fileExists: (p: string) => p === "/project/package.json" || p === "/project/tsconfig.json",
      readFile: (p: string) =>
        p === "/project/package.json" ? '{"scripts":{"dev":"vite"}}' : null,
      execWithTimeout: () => ({
        stdout: "",
        stderr: "",
        exitCode: 1,
        timedOut: true,
      }),
      signal: {
        baseDir: "/tmp",
        ensureDir: () => ({ ok: true, value: undefined }) as const,
        appendFile: () => ({ ok: true, value: undefined }) as const,
      },
      stderr: () => {},
    };

    const result = TypeCheckVerifier.execute(makeInput("Edit", "/project/src/file.ts"), deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.continue).toBe(true);
  });
});

// ─── Additional coverage ────────────────────────────────────────────────────

describe("discoverTypeCheck — standalone tsconfig", () => {
  beforeEach(() => _resetDebounceCache());

  test("discovers tsc --noEmit from standalone tsconfig.json", () => {
    const deps = {
      fileExists: (p: string) => p === "/project/tsconfig.json",
      readFile: () => null,
    };
    const result = discoverTypeCheck("/project/src/file.ts", deps);
    expect(result).not.toBeNull();
    expect(result!.cmd).toBe("npx");
    expect(result!.args).toContain("tsc");
    expect(result!.cwd).toBe("/project");
  });
});

describe("TypeCheckVerifier — debounce", () => {
  beforeEach(() => _resetDebounceCache());

  test("second execute for same file is debounced (continues immediately)", () => {
    const deps: TypeCheckVerifierDeps = {
      fileExists: (p: string) => p === "/project/tsconfig.json",
      readFile: () => null,
      execWithTimeout: () => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
        timedOut: false,
      }),
      signal: {
        baseDir: "/tmp/test",
        ensureDir: () => ({ ok: true, value: undefined }) as const,
        appendFile: () => ({ ok: true, value: undefined }) as const,
      },
      stderr: () => {},
    };
    const input: ToolHookInput = {
      session_id: "test-debounce",
      tool_name: "Edit",
      tool_input: { file_path: "/project/src/debounce-test.ts" },
    };

    // First call — runs check
    const result1 = TypeCheckVerifier.execute(input, deps);
    expect(result1.ok).toBe(true);

    // Second call within debounce — skips check, returns continue
    const result2 = TypeCheckVerifier.execute(input, deps);
    expect(result2.ok).toBe(true);
    if (result2.ok) expect(result2.value.continue).toBe(true);
  });
});

describe("TypeCheckVerifier defaultDeps", () => {
  test("defaultDeps.readFile returns null for missing file", () => {
    expect(TypeCheckVerifier.defaultDeps.readFile("/tmp/pai-nonexistent-tcv.ts")).toBeNull();
  });

  test("defaultDeps.execWithTimeout returns exitCode 1 on failure", () => {
    const result = TypeCheckVerifier.defaultDeps.execWithTimeout("false", [], "/tmp", 5000);
    expect(result.exitCode).not.toBe(0);
  });

  test("defaultDeps.stderr writes without throwing", () => {
    expect(() => TypeCheckVerifier.defaultDeps.stderr("test")).not.toThrow();
  });
});
