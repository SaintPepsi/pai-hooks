import { describe, expect, test } from "bun:test";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { CitationEnforcementDeps } from "@hooks/hooks/ObligationStateMachines/CitationEnforcement.shared";
import { CitationEnforcement } from "./CitationEnforcement.contract";

function makeDeps(overrides: Partial<CitationEnforcementDeps> = {}): CitationEnforcementDeps {
  return {
    stateDir: "/tmp/test-state",
    fileExists: () => true,
    writeFlag: () => {},
    readReminded: () => [],
    writeReminded: () => {},
    stderr: () => {},
    ...overrides,
  };
}

function makeWriteInput(filePath: string): ToolHookInput {
  return {
    hook_type: "PostToolUse",
    tool_name: "Write",
    tool_input: { file_path: filePath, content: "test" },
  };
}

describe("CitationEnforcement", () => {
  test("has correct name and event", () => {
    expect(CitationEnforcement.name).toBe("CitationEnforcement");
    expect(CitationEnforcement.event).toBe("PostToolUse");
  });

  describe("accepts", () => {
    test("accepts Write tool", () => {
      expect(CitationEnforcement.accepts(makeWriteInput("/tmp/file.ts"))).toBe(true);
    });

    test("accepts Edit tool", () => {
      const input: ToolHookInput = {
        hook_type: "PostToolUse",
        tool_name: "Edit",
        tool_input: { file_path: "/tmp/file.ts", old_string: "a", new_string: "b" },
      };
      expect(CitationEnforcement.accepts(input)).toBe(true);
    });

    test("rejects other tools", () => {
      const input: ToolHookInput = {
        hook_type: "PostToolUse",
        tool_name: "Bash",
        tool_input: { command: "ls" },
      };
      expect(CitationEnforcement.accepts(input)).toBe(false);
    });
  });

  describe("execute", () => {
    test("returns continue without context when no flag file", () => {
      const deps = makeDeps({ fileExists: () => false });
      const result = CitationEnforcement.execute(makeWriteInput("/tmp/file.ts"), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("continue");
        expect(result.value.additionalContext).toBeUndefined();
      }
    });

    test("returns continue without context when no file_path in input", () => {
      const input: ToolHookInput = {
        hook_type: "PostToolUse",
        tool_name: "Write",
        tool_input: { content: "test" },
      };
      const result = CitationEnforcement.execute(input, makeDeps());
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.additionalContext).toBeUndefined();
    });

    test("injects citation reminder for new file", () => {
      const result = CitationEnforcement.execute(makeWriteInput("/tmp/article.md"), makeDeps());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.additionalContext).toContain("citation");
      }
    });

    test("skips already-reminded files", () => {
      const deps = makeDeps({
        readReminded: () => ["/tmp/article.md"],
      });
      const result = CitationEnforcement.execute(makeWriteInput("/tmp/article.md"), deps);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.additionalContext).toBeUndefined();
    });

    test("writes reminded file to state", () => {
      let writtenFiles: string[] = [];
      const deps = makeDeps({
        writeReminded: (_path, files) => {
          writtenFiles = files;
        },
      });
      CitationEnforcement.execute(makeWriteInput("/tmp/new-file.ts"), deps);
      expect(writtenFiles).toContain("/tmp/new-file.ts");
    });
  });
});
