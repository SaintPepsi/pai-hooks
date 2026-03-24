import { describe, it, expect } from "bun:test";
import { QuestionAnswered, type QuestionAnsweredDeps } from "@hooks/hooks/QuestionAnswered/QuestionAnswered/QuestionAnswered.contract";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { TabState } from "@hooks/lib/tab-constants";

interface CapturedTabState {
  title: string;
  state: TabState;
  previousTitle?: string;
  sessionId?: string;
}

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
    const result = QuestionAnswered.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    expect(result.value?.type).toBe("silent");
  });

  it("restores previous title when available", () => {
    const captured: { state: CapturedTabState | null } = { state: null };
    const deps = makeDeps({
      setTabState: (state) => { captured.state = state as CapturedTabState; },
      readTabState: () => ({ title: "teal title", previousTitle: "Old Working Title", state: "question" as const }),
      stripPrefix: (s: string) => s,
    });
    QuestionAnswered.execute(makeInput(), deps);
    expect(captured.state?.state).toBe("working");
    expect(captured.state?.title).toContain("Old Working Title");
  });

  it("uses fallback when no previous title", () => {
    const captured: { state: CapturedTabState | null } = { state: null };
    const deps = makeDeps({
      setTabState: (state) => { captured.state = state as CapturedTabState; },
    });
    QuestionAnswered.execute(makeInput(), deps);
    expect(captured.state?.title).toContain("Processing answer");
  });
});
