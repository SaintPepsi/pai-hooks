import { beforeEach, describe, expect, it } from "bun:test";
import type { PreToolUseHookSpecificOutput } from "@anthropic-ai/claude-agent-sdk";
import { fileNotFound } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  _resetSessionState,
  CodingStandardsInjector,
  type CodingStandardsInjectorDeps,
} from "@hooks/hooks/CodingStandards/CodingStandardsInjector/CodingStandardsInjector.contract";

function makeInput(toolName: "Write" | "Edit" = "Write"): ToolHookInput {
  return {
    session_id: "test-session",
    tool_name: toolName,
    tool_input: { file_path: "/tmp/test.ts", content: "// test" },
  };
}

function makeDeps(
  overrides: Partial<CodingStandardsInjectorDeps> = {},
): CodingStandardsInjectorDeps {
  const files: Record<string, string> = {
    "/mock/settings.json": JSON.stringify({ codingStandards: ["standards/test.md"] }),
    "/mock/standards/test.md": "# Test Standards\n\nUse Result<T, E> pipelines.",
  };

  return {
    readFile: (path: string) => {
      const content = files[path];
      if (content !== undefined) return ok(content);
      return err(fileNotFound(path));
    },
    paiDir: "/mock",
    settingsPath: "/mock/settings.json",
    stderr: () => {},
    ...overrides,
  };
}

describe("CodingStandardsInjector", () => {
  beforeEach(() => {
    _resetSessionState();
  });

  describe("accepts", () => {
    it("accepts Write tool", () => {
      expect(CodingStandardsInjector.accepts(makeInput("Write"))).toBe(true);
    });

    it("accepts Edit tool", () => {
      expect(CodingStandardsInjector.accepts(makeInput("Edit"))).toBe(true);
    });

    it("rejects other tools", () => {
      const input = { ...makeInput(), tool_name: "Read" } as ToolHookInput;
      expect(CodingStandardsInjector.accepts(input)).toBe(false);
    });
  });

  describe("execute", () => {
    it("injects coding standards on first Write", () => {
      const deps = makeDeps();
      const result = CodingStandardsInjector.execute(makeInput(), deps);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.continue).toBe(true);
      expect(result.value.hookSpecificOutput?.hookEventName).toBe("PreToolUse");
      const specific = result.value.hookSpecificOutput as PreToolUseHookSpecificOutput;
      expect(specific.additionalContext).toContain("Test Standards");
    });

    it("skips injection on subsequent Write (session dedup)", () => {
      const deps = makeDeps();

      // First call injects
      const first = CodingStandardsInjector.execute(makeInput(), deps);
      expect(first.ok).toBe(true);
      if (first.ok) {
        const specific = first.value.hookSpecificOutput as PreToolUseHookSpecificOutput;
        expect(specific.additionalContext).toBeDefined();
      }

      // Second call skips
      const second = CodingStandardsInjector.execute(makeInput(), deps);
      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.value.hookSpecificOutput).toBeUndefined();
      }
    });

    it("returns continue:true when no codingStandards configured", () => {
      const deps = makeDeps({
        readFile: (path: string) => {
          if (path === "/mock/settings.json") {
            return ok(JSON.stringify({}));
          }
          return err(fileNotFound(path));
        },
      });

      const result = CodingStandardsInjector.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.continue).toBe(true);
        expect(result.value.hookSpecificOutput).toBeUndefined();
      }
    });

    it("skips files over 50KB", () => {
      const largeContent = "x".repeat(51 * 1024);
      const stderrCalls: string[] = [];

      const deps = makeDeps({
        readFile: (path: string) => {
          if (path === "/mock/settings.json") {
            return ok(JSON.stringify({ codingStandards: ["large.md"] }));
          }
          if (path === "/mock/large.md") {
            return ok(largeContent);
          }
          return err(fileNotFound(path));
        },
        stderr: (msg: string) => stderrCalls.push(msg),
      });

      const result = CodingStandardsInjector.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      expect(stderrCalls.some((msg) => msg.includes("exceeds 50KB"))).toBe(true);
    });

    it("handles missing standards file gracefully", () => {
      const stderrCalls: string[] = [];

      const deps = makeDeps({
        readFile: (path: string) => {
          if (path === "/mock/settings.json") {
            return ok(JSON.stringify({ codingStandards: ["missing.md"] }));
          }
          return err(fileNotFound(path));
        },
        stderr: (msg: string) => stderrCalls.push(msg),
      });

      const result = CodingStandardsInjector.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      expect(stderrCalls.some((msg) => msg.includes("Cannot read"))).toBe(true);
    });

    it("resolves absolute paths without modification", () => {
      const deps = makeDeps({
        readFile: (path: string) => {
          if (path === "/mock/settings.json") {
            return ok(JSON.stringify({ codingStandards: ["/absolute/path.md"] }));
          }
          if (path === "/absolute/path.md") {
            return ok("# Absolute Standards");
          }
          return err(fileNotFound(path));
        },
      });

      const result = CodingStandardsInjector.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const specific = result.value.hookSpecificOutput as PreToolUseHookSpecificOutput;
        expect(specific.additionalContext).toContain("Absolute Standards");
      }
    });
  });
});
