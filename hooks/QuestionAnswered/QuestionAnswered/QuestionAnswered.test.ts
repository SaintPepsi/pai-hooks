import { describe, expect, it } from "bun:test";
import {
  QuestionAnswered,
  type QuestionAnsweredDeps,
} from "@hooks/hooks/QuestionAnswered/QuestionAnswered/QuestionAnswered.contract";

const stubInput = {
  session_id: "test-session",
  tool_name: "AskUserQuestion",
  tool_input: {},
} as const;

function makeDeps(overrides: Partial<QuestionAnsweredDeps> = {}): QuestionAnsweredDeps {
  return {
    stderr: () => {},
    ...overrides,
  };
}

describe("QuestionAnswered", () => {
  it("has correct name and event", () => {
    expect(QuestionAnswered.name).toBe("QuestionAnswered");
    expect(QuestionAnswered.event).toBe("PostToolUse");
  });

  it("accepts any input", () => {
    expect(QuestionAnswered.accepts(stubInput)).toBe(true);
  });

  it("returns ok with silent no-op", () => {
    const result = QuestionAnswered.execute(stubInput, makeDeps());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
  });
});
