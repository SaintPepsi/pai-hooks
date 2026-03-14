import { describe, it, expect } from "bun:test";
import { AgentExecutionGuard } from "./AgentExecutionGuard";
import type { ToolHookInput } from "../core/types/hook-inputs";

function makeInput(overrides: Record<string, unknown> = {}): ToolHookInput {
  return {
    session_id: "test",
    tool_name: "Task",
    tool_input: { subagent_type: "general-purpose", description: "test task", ...overrides },
  };
}

describe("AgentExecutionGuard", () => {
  it("has correct name and event", () => {
    expect(AgentExecutionGuard.name).toBe("AgentExecutionGuard");
    expect(AgentExecutionGuard.event).toBe("PreToolUse");
  });

  it("passes when run_in_background is true", () => {
    const result = AgentExecutionGuard.execute(makeInput({ run_in_background: true }), {}) as any;
    expect(result.ok).toBe(true);
    expect(result.value.type).toBe("continue");
  });

  it("passes for Explore agent type", () => {
    const result = AgentExecutionGuard.execute(makeInput({ subagent_type: "Explore" }), {}) as any;
    expect(result.ok).toBe(true);
    expect(result.value.type).toBe("continue");
  });

  it("passes for haiku model", () => {
    const result = AgentExecutionGuard.execute(makeInput({ model: "haiku" }), {}) as any;
    expect(result.ok).toBe(true);
    expect(result.value.type).toBe("continue");
  });

  it("passes for FAST timing in prompt scope", () => {
    const result = AgentExecutionGuard.execute(
      makeInput({ prompt: "## Scope\nTiming: FAST\nDo something quick" }),
      {},
    ) as any;
    expect(result.ok).toBe(true);
    expect(result.value.type).toBe("continue");
  });

  it("warns for foreground non-fast agent", () => {
    const result = AgentExecutionGuard.execute(makeInput(), {}) as any;
    expect(result.ok).toBe(true);
    expect(result.value.type).toBe("context");
    expect(result.value.content).toContain("FOREGROUND AGENT DETECTED");
    expect(result.value.content).toContain("run_in_background");
  });

  it("warning includes agent description", () => {
    const result = AgentExecutionGuard.execute(
      makeInput({ description: "research task" }),
      {},
    ) as any;
    expect(result.value.content).toContain("research task");
  });
});
