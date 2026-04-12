import { describe, expect, it } from "bun:test";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { ResultError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  CodingStandardsAdvisor,
  type CodingStandardsAdvisorDeps,
} from "@hooks/hooks/CodingStandards/CodingStandardsAdvisor/CodingStandardsAdvisor.contract";
import { getPostToolUseAdvisory as getAdvisory } from "@hooks/hooks/CodingStandards/test-helpers";

// ─── Test Helpers ────────────────────────────────────────────────────────────

// Build fixture strings that contain relative imports without triggering
// the enforcer's own regex on THIS file's source text.
const REL_IMPORT = `import { foo } from "..` + `/utils/foo";`;

function makeDeps(overrides: Partial<CodingStandardsAdvisorDeps> = {}): CodingStandardsAdvisorDeps {
  return {
    readFile: () => null,
    stderr: () => {},
    ...overrides,
  };
}

function makeReadInput(filePath: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Read",
    tool_input: { file_path: filePath },
  };
}

function makeEditInput(filePath: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Edit",
    tool_input: { file_path: filePath, old_string: "a", new_string: "b" },
  };
}

function unwrap(result: Result<SyncHookJSONOutput, ResultError>): SyncHookJSONOutput {
  if (!result.ok) throw new Error(`Result not ok: ${result.error.message}`);
  return result.value;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CodingStandardsAdvisor", () => {
  it("has correct name and event", () => {
    expect(CodingStandardsAdvisor.name).toBe("CodingStandardsAdvisor");
    expect(CodingStandardsAdvisor.event).toBe("PostToolUse");
  });

  // ─── accepts() ──────────────────────────────────────────────────────────

  describe("accepts()", () => {
    it("accepts Read on .ts files", () => {
      expect(CodingStandardsAdvisor.accepts(makeReadInput("/src/app.ts"))).toBe(true);
    });

    it("accepts Read on .tsx files", () => {
      expect(CodingStandardsAdvisor.accepts(makeReadInput("/src/App.tsx"))).toBe(true);
    });

    it("rejects Edit operations", () => {
      expect(CodingStandardsAdvisor.accepts(makeEditInput("/src/app.ts"))).toBe(false);
    });

    it("rejects non-TypeScript files", () => {
      expect(CodingStandardsAdvisor.accepts(makeReadInput("/src/style.css"))).toBe(false);
    });

    it("skips adapter files", () => {
      expect(CodingStandardsAdvisor.accepts(makeReadInput("/src/adapters/fs.ts"))).toBe(false);
    });

    it("skips hooks/core/ files", () => {
      expect(
        CodingStandardsAdvisor.accepts(makeReadInput("/home/user/.claude/hooks/core/runner.ts")),
      ).toBe(false);
    });

    it("skips auto-generated module_bindings/ files", () => {
      expect(
        CodingStandardsAdvisor.accepts(
          makeReadInput("/project/src/lib/modes/online/module_bindings/types/reducers.ts"),
        ),
      ).toBe(false);
    });

    it("skips skipped filenames like vite.config.ts", () => {
      expect(CodingStandardsAdvisor.accepts(makeReadInput("/project/vite.config.ts"))).toBe(false);
    });

    it("rejects when tool_input is a string (no file_path object)", () => {
      const input: ToolHookInput = {
        session_id: "test-sess",
        tool_name: "Read",
        tool_input: "/src/app.ts" as unknown as Record<string, unknown>,
      };
      expect(CodingStandardsAdvisor.accepts(input)).toBe(false);
    });

    it("rejects when tool_input is null", () => {
      const input: ToolHookInput = {
        session_id: "test-sess",
        tool_name: "Read",
        tool_input: null as unknown as Record<string, unknown>,
      };
      expect(CodingStandardsAdvisor.accepts(input)).toBe(false);
    });
  });

  // ─── execute() ─────────────────────────────────────────────────────────

  describe("execute()", () => {
    it("continues silently for clean file", () => {
      const deps = makeDeps({
        readFile: () => "export function add(a: number, b: number) { return a + b; }",
      });
      const result = unwrap(CodingStandardsAdvisor.execute(makeReadInput("/src/math.ts"), deps));
      expect(result.continue).toBe(true);
      expect(getAdvisory(result)).toBeUndefined();
    });

    it("returns additionalContext for file with raw imports", () => {
      const deps = makeDeps({
        readFile: () => 'import { readFileSync } from "fs";\nconst x = 1;',
      });
      const result = unwrap(CodingStandardsAdvisor.execute(makeReadInput("/src/reader.ts"), deps));
      expect(result.continue).toBe(true);
      const advisory = getAdvisory(result) ?? "";
      expect(advisory).toContain("CODING STANDARDS");
      expect(advisory).toContain("raw Node builtin");
    });

    it("returns additionalContext for file with try-catch", () => {
      const deps = makeDeps({
        readFile: () =>
          "export function go() {\n  try {\n    doThing();\n  } catch (e) {\n    return null;\n  }\n}",
      });
      const result = unwrap(CodingStandardsAdvisor.execute(makeReadInput("/src/handler.ts"), deps));
      expect(getAdvisory(result) ?? "").toContain("try-catch");
    });

    it("returns additionalContext for file with process.env", () => {
      const deps = makeDeps({
        readFile: () => "export const port = process.env.PORT;",
      });
      const result = unwrap(CodingStandardsAdvisor.execute(makeReadInput("/src/config.ts"), deps));
      expect(getAdvisory(result) ?? "").toContain("process.env");
    });

    it("returns additionalContext for file with as any", () => {
      const deps = makeDeps({
        readFile: () => "const x = data as any;",
      });
      const result = unwrap(CodingStandardsAdvisor.execute(makeReadInput("/src/util.ts"), deps));
      expect(getAdvisory(result) ?? "").toContain("unsafe type cast");
    });

    it("returns additionalContext for file with relative imports", () => {
      const deps = makeDeps({ readFile: () => REL_IMPORT });
      const result = unwrap(CodingStandardsAdvisor.execute(makeReadInput("/src/index.ts"), deps));
      expect(getAdvisory(result) ?? "").toContain("relative import");
    });

    it("continues silently when file cannot be read", () => {
      const deps = makeDeps({ readFile: () => null });
      const result = unwrap(CodingStandardsAdvisor.execute(makeReadInput("/src/missing.ts"), deps));
      expect(result.continue).toBe(true);
      expect(getAdvisory(result)).toBeUndefined();
    });

    it("includes violation count in advisory", () => {
      const deps = makeDeps({
        readFile: () =>
          'import { readFileSync } from "fs";\nconst x = data as any;\nconst y = thing as any;',
      });
      const result = unwrap(CodingStandardsAdvisor.execute(makeReadInput("/src/bad.ts"), deps));
      expect(getAdvisory(result) ?? "").toContain("3 violations");
    });
  });

  describe("Svelte file handling", () => {
    it("continues when .svelte file has no script block", () => {
      const deps = makeDeps({ readFile: () => "<div>Just HTML</div>" });
      const result = unwrap(
        CodingStandardsAdvisor.execute(makeReadInput("/src/Comp.svelte"), deps),
      );
      expect(result.continue).toBe(true);
      expect(getAdvisory(result)).toBeUndefined();
    });

    it("checks violations in .svelte script block", () => {
      const svelteContent = ['<script lang="ts">', "const x = data as any;", "</script>"].join(
        "\n",
      );
      const deps = makeDeps({ readFile: () => svelteContent });
      const result = unwrap(
        CodingStandardsAdvisor.execute(makeReadInput("/src/Comp.svelte"), deps),
      );
      expect(getAdvisory(result)).toBeDefined();
    });
  });

  describe("defaultDeps", () => {
    it("defaultDeps.readFile returns null for missing file", () => {
      expect(CodingStandardsAdvisor.defaultDeps.readFile("/tmp/pai-nonexistent-csa.ts")).toBeNull();
    });

    it("defaultDeps.stderr writes without throwing", () => {
      expect(() => CodingStandardsAdvisor.defaultDeps.stderr("test")).not.toThrow();
    });
  });
});
