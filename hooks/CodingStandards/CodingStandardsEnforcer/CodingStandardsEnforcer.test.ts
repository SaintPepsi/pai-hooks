import { describe, it, expect } from "bun:test";
import {
  CodingStandardsEnforcer,
  type CodingStandardsEnforcerDeps,
} from "@hooks/contracts/CodingStandardsEnforcer";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput, BlockOutput } from "@hooks/core/types/hook-outputs";
import type { Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";

// ─── Test Helpers ────────────────────────────────────────────────────────────

// Build fixture strings that contain relative imports without triggering
// the enforcer's own regex on THIS file's source text.
const REL_IMPORT = `import { foo } from "..` + `/utils/foo";`;

function makeDeps(
  overrides: Partial<CodingStandardsEnforcerDeps> = {},
): CodingStandardsEnforcerDeps {
  return {
    readFile: () => null,
    signal: {
      baseDir: "/tmp/test-pai",
      appendFile: () => ({ ok: true, value: undefined }),
      ensureDir: () => ({ ok: true, value: undefined }),
    },
    stderr: () => {},
    ...overrides,
  };
}

function makeEditInput(
  filePath: string,
  oldStr: string,
  newStr: string,
): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Edit",
    tool_input: { file_path: filePath, old_string: oldStr, new_string: newStr },
  };
}

function makeWriteInput(filePath: string, content: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Write",
    tool_input: { file_path: filePath, content },
  };
}

function makeReadInput(filePath: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Read",
    tool_input: { file_path: filePath },
  };
}

function unwrap(
  result: Result<ContinueOutput | BlockOutput, PaiError>,
): ContinueOutput | BlockOutput {
  if (!result.ok) throw new Error(`Result not ok: ${result.error.message}`);
  return result.value;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CodingStandardsEnforcer", () => {
  it("has correct name and event", () => {
    expect(CodingStandardsEnforcer.name).toBe("CodingStandardsEnforcer");
    expect(CodingStandardsEnforcer.event).toBe("PreToolUse");
  });

  // ─── accepts() ──────────────────────────────────────────────────────────

  describe("accepts()", () => {
    it("accepts Edit on .ts files", () => {
      expect(
        CodingStandardsEnforcer.accepts(makeEditInput("/src/app.ts", "a", "b")),
      ).toBe(true);
    });

    it("accepts Write on .tsx files", () => {
      expect(
        CodingStandardsEnforcer.accepts(
          makeWriteInput("/src/App.tsx", "export default {}"),
        ),
      ).toBe(true);
    });

    it("rejects Read operations", () => {
      expect(CodingStandardsEnforcer.accepts(makeReadInput("/src/app.ts"))).toBe(
        false,
      );
    });

    it("rejects non-TypeScript files", () => {
      expect(
        CodingStandardsEnforcer.accepts(
          makeWriteInput("/src/style.css", "body {}"),
        ),
      ).toBe(false);
    });

    it("skips adapter files", () => {
      expect(
        CodingStandardsEnforcer.accepts(
          makeWriteInput("/src/adapters/fs.ts", "import fs from 'fs';"),
        ),
      ).toBe(false);
    });

    it("skips hooks/core/ files", () => {
      expect(
        CodingStandardsEnforcer.accepts(
          makeWriteInput(
            "/home/user/.claude/hooks/core/runner.ts",
            "import fs from 'fs';",
          ),
        ),
      ).toBe(false);
    });

    it("skips auto-generated module_bindings/ files", () => {
      expect(
        CodingStandardsEnforcer.accepts(
          makeEditInput(
            "/project/src/lib/modes/online/module_bindings/types/reducers.ts",
            "a",
            "b",
          ),
        ),
      ).toBe(false);
    });

    it("skips skipped filenames like vite.config.ts", () => {
      expect(
        CodingStandardsEnforcer.accepts(
          makeWriteInput("/project/vite.config.ts", "export default {}"),
        ),
      ).toBe(false);
    });
  });

  // ─── execute() — Write ──────────────────────────────────────────────────

  describe("execute() — Write", () => {
    it("continues for clean content", () => {
      const input = makeWriteInput(
        "/src/math.ts",
        "export function add(a: number, b: number): number {\n  return a + b;\n}",
      );
      const result = unwrap(CodingStandardsEnforcer.execute(input, makeDeps()));
      expect(result.type).toBe("continue");
    });

    it("blocks raw Node builtin imports", () => {
      const input = makeWriteInput(
        "/src/reader.ts",
        'import { readFileSync } from "fs";\nconst x = readFileSync("a");',
      );
      const result = unwrap(CodingStandardsEnforcer.execute(input, makeDeps()));
      expect(result.type).toBe("block");
    });

    it("blocks try-catch flow control", () => {
      const input = makeWriteInput(
        "/src/handler.ts",
        'export function go() {\n  try {\n    doThing();\n  } catch (e) {\n    return null;\n  }\n}',
      );
      const result = unwrap(CodingStandardsEnforcer.execute(input, makeDeps()));
      expect(result.type).toBe("block");
    });

    it("blocks direct process.env access", () => {
      const input = makeWriteInput(
        "/src/config.ts",
        "export const port = process.env.PORT;",
      );
      const result = unwrap(CodingStandardsEnforcer.execute(input, makeDeps()));
      expect(result.type).toBe("block");
    });

    it("blocks as any casts", () => {
      const input = makeWriteInput(
        "/src/util.ts",
        "const x = data as any;",
      );
      const result = unwrap(CodingStandardsEnforcer.execute(input, makeDeps()));
      expect(result.type).toBe("block");
    });

    it("blocks relative imports", () => {
      const input = makeWriteInput("/src/index.ts", REL_IMPORT);
      const result = unwrap(CodingStandardsEnforcer.execute(input, makeDeps()));
      expect(result.type).toBe("block");
    });

    it("blocks export default function", () => {
      const input = makeWriteInput(
        "/src/handler.ts",
        "export default function handler() { return 42; }",
      );
      const result = unwrap(CodingStandardsEnforcer.execute(input, makeDeps()));
      expect(result.type).toBe("block");
    });

    it("blocks export default object", () => {
      const input = makeWriteInput(
        "/src/config.ts",
        "const cfg = { port: 3000 };\nexport default cfg;",
      );
      const result = unwrap(CodingStandardsEnforcer.execute(input, makeDeps()));
      expect(result.type).toBe("block");
    });

    it("allows named exports", () => {
      const input = makeWriteInput(
        "/src/math.ts",
        "export function add(a: number, b: number): number {\n  return a + b;\n}\nexport const PI = 3.14;",
      );
      const result = unwrap(CodingStandardsEnforcer.execute(input, makeDeps()));
      expect(result.type).toBe("continue");
    });

    it("allows process.env inside defaultDeps", () => {
      const content = [
        "const defaultDeps = {",
        "  baseDir: process.env.HOME || '/tmp',",
        "};",
      ].join("\n");
      const input = makeWriteInput("/src/mod.ts", content);
      const result = unwrap(CodingStandardsEnforcer.execute(input, makeDeps()));
      expect(result.type).toBe("continue");
    });
  });

  // ─── execute() — Edit (full-file simulation) ───────────────────────────

  describe("execute() — Edit", () => {
    it("continues when edit produces clean file", () => {
      const existingContent = "export const name = 'old';";
      const deps = makeDeps({ readFile: () => existingContent });
      const input = makeEditInput("/src/mod.ts", "'old'", "'new'");
      const result = unwrap(CodingStandardsEnforcer.execute(input, deps));
      expect(result.type).toBe("continue");
    });

    it("blocks when existing file has violations even if edit is clean", () => {
      const existingContent =
        'import { readFileSync } from "fs";\nexport const name = "old";';
      const deps = makeDeps({ readFile: () => existingContent });
      const input = makeEditInput("/src/mod.ts", '"old"', '"new"');
      const result = unwrap(CodingStandardsEnforcer.execute(input, deps));
      expect(result.type).toBe("block");
    });

    it("blocks when edit introduces a violation", () => {
      const existingContent = "export const x = 1;";
      const deps = makeDeps({ readFile: () => existingContent });
      const input = makeEditInput(
        "/src/mod.ts",
        "export const x = 1;",
        'import { readFileSync } from "fs";\nexport const x = 1;',
      );
      const result = unwrap(CodingStandardsEnforcer.execute(input, deps));
      expect(result.type).toBe("block");
    });

    it("continues when file does not exist on disk and editParts are empty", () => {
      const deps = makeDeps({ readFile: () => null });
      const input = makeEditInput(
        "/src/new.ts",
        "",
        "export const y = 2;",
      );
      const result = unwrap(CodingStandardsEnforcer.execute(input, deps));
      expect(result.type).toBe("continue");
    });

    it("checks just new_string when file does not exist on disk (new file via edit)", () => {
      const deps = makeDeps({ readFile: () => null });
      const input = makeEditInput(
        "/src/new.ts",
        "placeholder",
        "export const y = 2;",
      );
      const result = unwrap(CodingStandardsEnforcer.execute(input, deps));
      expect(result.type).toBe("continue");
    });

    it("continues when Edit is missing old_string", () => {
      const deps = makeDeps({ readFile: () => null });
      const input: ToolHookInput = {
        session_id: "test-sess",
        tool_name: "Edit",
        tool_input: { file_path: "/src/new.ts", new_string: "export const y = 2;" },
      };
      const result = unwrap(CodingStandardsEnforcer.execute(input, deps));
      expect(result.type).toBe("continue");
    });

    it("continues when Edit is missing new_string", () => {
      const deps = makeDeps({ readFile: () => null });
      const input: ToolHookInput = {
        session_id: "test-sess",
        tool_name: "Edit",
        tool_input: { file_path: "/src/new.ts", old_string: "placeholder" },
      };
      const result = unwrap(CodingStandardsEnforcer.execute(input, deps));
      expect(result.type).toBe("continue");
    });

    it("blocks new_string violations when file does not exist on disk", () => {
      const deps = makeDeps({ readFile: () => null });
      const input = makeEditInput(
        "/src/new.ts",
        "placeholder",
        'import { readFileSync } from "fs";\nexport const y = 2;',
      );
      const result = unwrap(CodingStandardsEnforcer.execute(input, deps));
      expect(result.type).toBe("block");
    });
  });

  // ─── Block message format ──────────────────────────────────────────────

  describe("block message format", () => {
    it("includes violation count and file path", () => {
      const input = makeWriteInput(
        "/src/bad.ts",
        'import { readFileSync } from "fs";\nconst x = data as any;',
      );
      const result = unwrap(CodingStandardsEnforcer.execute(input, makeDeps()));
      if (result.type !== "block") throw new Error("Expected block");
      expect(result.reason).toContain("2 violations");
      expect(result.reason).toContain("/src/bad.ts");
    });

    it("includes fix instructions for violated categories only", () => {
      const input = makeWriteInput("/src/bad.ts", "const x = data as any;");
      const result = unwrap(CodingStandardsEnforcer.execute(input, makeDeps()));
      if (result.type !== "block") throw new Error("Expected block");
      expect(result.reason).toContain("proper types");
      expect(result.reason).not.toContain("adapters");
      expect(result.reason).not.toContain("try-catch");
    });
  });
});
