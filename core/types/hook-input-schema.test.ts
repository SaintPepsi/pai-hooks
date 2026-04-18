/**
 * Tests for hook-input-schema.ts — Effect Schema discriminated union.
 */

import { describe, expect, it } from "bun:test";
import {
  getEventType,
  type ParsedHookInput,
  parseHookInput,
} from "@hooks/core/types/hook-input-schema";
import { Either } from "effect";

describe("parseHookInput", () => {
  it("parses SessionStart input", () => {
    const result = parseHookInput({
      session_id: "s1",
      hook_event_name: "SessionStart",
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(getEventType(result.right)).toBe("SessionStart");
    }
  });

  it("parses UserPromptSubmit input with prompt", () => {
    const result = parseHookInput({
      session_id: "s1",
      hook_event_name: "UserPromptSubmit",
      prompt: "hello",
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(getEventType(result.right)).toBe("UserPromptSubmit");
      expect((result.right as { prompt?: string }).prompt).toBe("hello");
    }
  });

  it("parses PreToolUse input", () => {
    const result = parseHookInput({
      session_id: "s1",
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: "foo.ts" },
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(getEventType(result.right)).toBe("PreToolUse");
    }
  });

  it("parses PostToolUse input", () => {
    const result = parseHookInput({
      session_id: "s1",
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: "foo.ts" },
      tool_response: "done",
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(getEventType(result.right)).toBe("PostToolUse");
    }
  });

  it("parses Stop input with last_assistant_message", () => {
    const result = parseHookInput({
      session_id: "s1",
      hook_event_name: "Stop",
      last_assistant_message: "quick fix here",
      stop_hook_active: true,
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(getEventType(result.right)).toBe("Stop");
      expect((result.right as { last_assistant_message?: string }).last_assistant_message).toBe(
        "quick fix here",
      );
    }
  });

  it("parses PreCompact input", () => {
    const result = parseHookInput({
      session_id: "s1",
      hook_event_name: "PreCompact",
      trigger: "auto",
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(getEventType(result.right)).toBe("PreCompact");
    }
  });

  it("parses SubagentStart input", () => {
    const result = parseHookInput({
      session_id: "s1",
      hook_event_name: "SubagentStart",
      transcript_path: "/tmp/t.jsonl",
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(getEventType(result.right)).toBe("SubagentStart");
    }
  });

  it("parses SubagentStop input", () => {
    const result = parseHookInput({
      session_id: "s1",
      hook_event_name: "SubagentStop",
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(getEventType(result.right)).toBe("SubagentStop");
    }
  });

  it("parses PermissionRequest input", () => {
    const result = parseHookInput({
      session_id: "s1",
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
      tool_input: { command: "echo hello" },
    });
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(getEventType(result.right)).toBe("PermissionRequest");
    }
  });

  it("rejects input with missing session_id", () => {
    const result = parseHookInput({ hook_event_name: "SessionStart" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects input with invalid hook_event_name", () => {
    const result = parseHookInput({
      session_id: "s1",
      hook_event_name: "InvalidEvent",
    });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects input with missing hook_event_name", () => {
    const result = parseHookInput({ session_id: "s1" });
    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects PreToolUse without tool_name", () => {
    const result = parseHookInput({
      session_id: "s1",
      hook_event_name: "PreToolUse",
      tool_input: {},
    });
    expect(Either.isLeft(result)).toBe(true);
  });
});

describe("getEventType", () => {
  it("returns the hook_event_name directly from parsed input", () => {
    const cases: Array<{ hook_event_name: string }> = [
      { hook_event_name: "SessionStart" },
      { hook_event_name: "UserPromptSubmit" },
      { hook_event_name: "PreToolUse" },
      { hook_event_name: "PostToolUse" },
      { hook_event_name: "Stop" },
      { hook_event_name: "PreCompact" },
      { hook_event_name: "SubagentStart" },
      { hook_event_name: "SubagentStop" },
      { hook_event_name: "PermissionRequest" },
    ];
    for (const c of cases) {
      expect(getEventType(c as ParsedHookInput)).toBe(c.hook_event_name);
    }
  });
});
