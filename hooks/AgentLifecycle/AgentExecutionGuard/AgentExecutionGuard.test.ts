import { describe, expect, it } from "bun:test";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { getInjectedContextFor } from "@hooks/lib/test-helpers";
import { AgentExecutionGuard, type AgentExecutionGuardDeps } from "./AgentExecutionGuard.contract";

const noDeps: AgentExecutionGuardDeps = { stderr: () => {} };

function makeInput(overrides: Record<string, unknown> = {}): ToolHookInput {
  return {
    session_id: "test",
    tool_name: "Task",
    tool_input: {
      subagent_type: "general-purpose",
      description: "test task",
      ...overrides,
    },
  };
}

describe("AgentExecutionGuard", () => {
  it("has correct name and event", () => {
    expect(AgentExecutionGuard.name).toBe("AgentExecutionGuard");
    expect(AgentExecutionGuard.event).toBe("PreToolUse");
  });

  it("passes when run_in_background is true", () => {
    const result = AgentExecutionGuard.execute(makeInput({ run_in_background: true }), noDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
    expect(getInjectedContextFor(result.value, "PreToolUse")).toBeUndefined();
  });

  it("passes for Explore agent type", () => {
    const result = AgentExecutionGuard.execute(makeInput({ subagent_type: "Explore" }), noDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
    expect(getInjectedContextFor(result.value, "PreToolUse")).toBeUndefined();
  });

  it("passes for haiku model", () => {
    const result = AgentExecutionGuard.execute(makeInput({ model: "haiku" }), noDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
    expect(getInjectedContextFor(result.value, "PreToolUse")).toBeUndefined();
  });

  it("passes for FAST timing in prompt scope", () => {
    const result = AgentExecutionGuard.execute(
      makeInput({ prompt: "## Scope\nTiming: FAST\nDo something quick" }),
      noDeps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
    expect(getInjectedContextFor(result.value, "PreToolUse")).toBeUndefined();
  });

  it("warns for foreground non-fast agent", () => {
    const result = AgentExecutionGuard.execute(makeInput(), noDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    const ctx = getInjectedContextFor(result.value, "PreToolUse");
    expect(ctx).toContain("FOREGROUND AGENT DETECTED");
    expect(ctx).toContain("run_in_background");
  });

  it("warning includes agent description", () => {
    const result = AgentExecutionGuard.execute(makeInput({ description: "research task" }), noDeps);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    const ctx = getInjectedContextFor(result.value, "PreToolUse");
    expect(ctx).toContain("research task");
  });
});
