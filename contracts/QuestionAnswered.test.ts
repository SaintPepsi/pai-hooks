import { describe, it, expect } from "bun:test";
import { QuestionAnswered, type QuestionAnsweredDeps } from "./QuestionAnswered";
import type { ToolHookInput } from "../core/types/hook-inputs";

function makeDeps(overrides: Partial<QuestionAnsweredDeps> = {}): QuestionAnsweredDeps {
  return {
    setTabState: () => {},
    readTabState: () => null,
    stripPrefix: (s: string) => s,
    stderr: () => {},
    ...overrides,
  };
}

function makeInput(): ToolHookInput {
  return {
    session_id: "test",
    tool_name: "AskUserQuestion",
    tool_input: {},
  };
}

describe("QuestionAnswered", () => {
  it("has correct name and event", () => {
    expect(QuestionAnswered.name).toBe("QuestionAnswered");
    expect(QuestionAnswered.event).toBe("PostToolUse");
  });

  it("returns silent output", () => {
    const deps = makeDeps();
    const result = QuestionAnswered.execute(makeInput(), deps) as any;
    expect(result.ok).toBe(true);
    expect(result.value.type).toBe("silent");
  });

  it("restores previous title when available", () => {
    let capturedState: any = null;
    const deps = makeDeps({
      setTabState: (state: any) => { capturedState = state; },
      readTabState: () => ({ title: "teal title", previousTitle: "Old Working Title", state: "question" }),
      stripPrefix: (s: string) => s,
    });
    QuestionAnswered.execute(makeInput(), deps);
    expect(capturedState.state).toBe("working");
    expect(capturedState.title).toContain("Old Working Title");
  });

  it("uses fallback when no previous title", () => {
    let capturedState: any = null;
    const deps = makeDeps({
      setTabState: (state: any) => { capturedState = state; },
    });
    QuestionAnswered.execute(makeInput(), deps);
    expect(capturedState.title).toContain("Processing answer");
  });
});
