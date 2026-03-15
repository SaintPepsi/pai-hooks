import { describe, it, expect } from "bun:test";
import { AgentExecutionGuard, type AgentExecutionGuardDeps } from "@hooks/contracts/AgentExecutionGuard";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput, ContextOutput } from "@hooks/core/types/hook-outputs";
import type { Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";

const noDeps: AgentExecutionGuardDeps = { stderr: () => {} };

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
    const result: Result<ContinueOutput | ContextOutput, PaiError> = AgentExecutionGuard.execute(makeInput({ run_in_background: true }), noDeps);
    expect(result.ok).toBe(true);
    expect(result.value!.type).toBe("continue");
  });

  it("passes for Explore agent type", () => {
    const result: Result<ContinueOutput | ContextOutput, PaiError> = AgentExecutionGuard.execute(makeInput({ subagent_type: "Explore" }), noDeps);
    expect(result.ok).toBe(true);
    expect(result.value!.type).toBe("continue");
  });

  it("passes for haiku model", () => {
    const result: Result<ContinueOutput | ContextOutput, PaiError> = AgentExecutionGuard.execute(makeInput({ model: "haiku" }), noDeps);
    expect(result.ok).toBe(true);
    expect(result.value!.type).toBe("continue");
  });

  it("passes for FAST timing in prompt scope", () => {
    const result: Result<ContinueOutput | ContextOutput, PaiError> = AgentExecutionGuard.execute(
      makeInput({ prompt: "## Scope\nTiming: FAST\nDo something quick" }),
      noDeps,
    );
    expect(result.ok).toBe(true);
    expect(result.value!.type).toBe("continue");
  });

  it("warns for foreground non-fast agent", () => {
    const result: Result<ContinueOutput | ContextOutput, PaiError> = AgentExecutionGuard.execute(makeInput(), noDeps);
    expect(result.ok).toBe(true);
    expect(result.value!.type).toBe("context");
    const output = result.value as ContextOutput;
    expect(output.content).toContain("FOREGROUND AGENT DETECTED");
    expect(output.content).toContain("run_in_background");
  });

  it("warning includes agent description", () => {
    const result: Result<ContinueOutput | ContextOutput, PaiError> = AgentExecutionGuard.execute(
      makeInput({ description: "research task" }),
      noDeps,
    );
    const output = result.value as ContextOutput;
    expect(output.content).toContain("research task");
  });
});
