import { describe, expect, test } from "bun:test";
import { fileReadFailed } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  AgentPrepromptInjector,
  type AgentPrepromptInjectorDeps,
} from "./AgentPrepromptInjector.contract";

const TEMPLATE = "# Worker: {{agent_name}}\nThread: {{thread_id}}\nTask: {{task_description}}";

function makeDeps(overrides: Partial<AgentPrepromptInjectorDeps> = {}): AgentPrepromptInjectorDeps {
  return {
    fileExists: () => true,
    readFile: () => ok(TEMPLATE),
    getKoordConfig: () => ({ prepromptPath: null }),
    getCwd: () => "/projects/koord",
    stderr: () => {},
    ...overrides,
  };
}

function makeInput(overrides: Record<string, unknown> = {}): ToolHookInput {
  return {
    session_id: "test",
    hook_type: "PreToolUse",
    tool_name: "Agent",
    tool_input: {
      prompt: "implement feature X",
      run_in_background: true,
      name: "dev-42",
      thread_id: "12345678901234567",
      ...overrides,
    },
  };
}

describe("AgentPrepromptInjector", () => {
  test("has correct name and event", () => {
    expect(AgentPrepromptInjector.name).toBe("AgentPrepromptInjector");
    expect(AgentPrepromptInjector.event).toBe("PreToolUse");
  });

  describe("accepts", () => {
    test("accepts Agent tool with run_in_background", () => {
      expect(AgentPrepromptInjector.accepts(makeInput())).toBe(true);
    });

    test("rejects Agent tool without run_in_background", () => {
      expect(AgentPrepromptInjector.accepts(makeInput({ run_in_background: false }))).toBe(false);
    });

    test("rejects non-Agent tools", () => {
      const input: ToolHookInput = {
        session_id: "test",
        hook_type: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "ls", run_in_background: true },
      };
      expect(AgentPrepromptInjector.accepts(input)).toBe(false);
    });
  });

  describe("execute", () => {
    test("injects preprompt with template variables replaced", () => {
      const result = AgentPrepromptInjector.execute(makeInput(), makeDeps());
      expect(result.ok).toBe(true);
      if (result.ok) {
        const hso = result.value.hookSpecificOutput;
        if (hso && hso.hookEventName === "PreToolUse") {
          const prompt = hso.updatedInput?.prompt as string;
          expect(prompt).toContain("implement feature X");
          expect(prompt).toContain("Worker: dev-42");
          expect(prompt).toContain("Thread: 12345678901234567");
          expect(prompt).toContain("Task: implement feature X");
        } else {
          throw new Error("Expected PreToolUse hookSpecificOutput with updatedInput");
        }
      }
    });

    test("returns continue when template file not found", () => {
      const deps = makeDeps({ fileExists: () => false });
      const result = AgentPrepromptInjector.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.continue).toBe(true);
    });

    test("returns continue when template read fails", () => {
      const deps = makeDeps({
        readFile: () => err(fileReadFailed("/path", new Error("ENOENT"))),
      });
      const result = AgentPrepromptInjector.execute(makeInput(), deps);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.continue).toBe(true);
    });

    test("uses config prepromptPath when available", () => {
      let checkedPath = "";
      const deps = makeDeps({
        getKoordConfig: () => ({ prepromptPath: "/custom/worker.md" }),
        fileExists: (path) => {
          checkedPath = path;
          return true;
        },
      });
      AgentPrepromptInjector.execute(makeInput(), deps);
      expect(checkedPath).toBe("/custom/worker.md");
    });

    test("falls back to cwd/src/prompts/worker.md", () => {
      let checkedPath = "";
      const deps = makeDeps({
        fileExists: (path) => {
          checkedPath = path;
          return true;
        },
      });
      AgentPrepromptInjector.execute(makeInput(), deps);
      expect(checkedPath).toBe("/projects/koord/src/prompts/worker.md");
    });

    test("uses defaults when template variables missing from input", () => {
      const input = makeInput({ name: undefined, thread_id: undefined });
      const result = AgentPrepromptInjector.execute(input, makeDeps());
      expect(result.ok).toBe(true);
      if (result.ok) {
        const hso = result.value.hookSpecificOutput;
        if (hso && hso.hookEventName === "PreToolUse") {
          const prompt = hso.updatedInput?.prompt as string;
          expect(prompt).toContain("Worker: worker");
          expect(prompt).toContain("Thread: unknown");
        } else {
          throw new Error("Expected PreToolUse hookSpecificOutput with updatedInput");
        }
      }
    });
  });
});
