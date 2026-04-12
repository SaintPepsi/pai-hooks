/**
 * Tests for core/types/hook-inputs.ts — input type shape verification.
 */

import { describe, expect, it } from "bun:test";
import type {
  HookInput,
  PreCompactInput,
  SessionStartInput,
  StopInput,
  SubagentStartInput,
  ToolHookInput,
  UserPromptSubmitInput,
} from "@hooks/core/types/hook-inputs";

describe("hook input types", () => {
  it("SessionStartInput requires session_id", () => {
    const input: SessionStartInput = { session_id: "s1" };
    expect(input.session_id).toBe("s1");
  });

  it("UserPromptSubmitInput accepts prompt and transcript_path", () => {
    const input: UserPromptSubmitInput = {
      session_id: "s1",
      prompt: "hello",
      transcript_path: "/tmp/t.jsonl",
    };
    expect(input.prompt).toBe("hello");
    expect(input.transcript_path).toBe("/tmp/t.jsonl");
  });

  it("ToolHookInput requires tool_name and tool_input", () => {
    const input: ToolHookInput = {
      session_id: "s1",
      tool_name: "Edit",
      tool_input: { file_path: "foo.ts" },
    };
    expect(input.tool_name).toBe("Edit");
    expect(input.tool_input.file_path).toBe("foo.ts");
  });

  it("ToolHookInput accepts optional tool_response for PostToolUse", () => {
    const input: ToolHookInput = {
      session_id: "s1",
      tool_name: "Read",
      tool_input: {},
      tool_response: "content",
    };
    expect(input.tool_response).toBe("content");
  });

  it("StopInput accepts last_assistant_message and stop_hook_active", () => {
    const input: StopInput = {
      session_id: "s1",
      last_assistant_message: "Done.",
      stop_hook_active: true,
    };
    expect(input.last_assistant_message).toBe("Done.");
    expect(input.stop_hook_active).toBe(true);
  });

  it("StopInput fields are optional", () => {
    const input: StopInput = { session_id: "s1" };
    expect(input.last_assistant_message).toBeUndefined();
    expect(input.stop_hook_active).toBeUndefined();
  });

  it("SubagentStartInput accepts transcript_path", () => {
    const input: SubagentStartInput = {
      session_id: "s1",
      transcript_path: "/tmp/sub.jsonl",
    };
    expect(input.transcript_path).toBe("/tmp/sub.jsonl");
  });

  it("PreCompactInput accepts trigger", () => {
    const input: PreCompactInput = { session_id: "s1", trigger: "auto" };
    expect(input.trigger).toBe("auto");
  });

  it("HookInput union accepts all input types", () => {
    const inputs: HookInput[] = [
      { session_id: "s1" },
      { session_id: "s1", prompt: "test" },
      { session_id: "s1", tool_name: "Edit", tool_input: {} },
      {
        session_id: "s1",
        last_assistant_message: "done",
        stop_hook_active: true,
      },
      { session_id: "s1", transcript_path: "/tmp/t.jsonl" },
      { session_id: "s1", trigger: "auto" },
    ];
    expect(inputs).toHaveLength(6);
  });
});
