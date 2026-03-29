import { describe, expect, test } from "bun:test";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { MessageQueueRelay, type MessageQueueRelayDeps } from "./MessageQueueRelay.contract";

const mockDeps: MessageQueueRelayDeps = {
  stderr: () => {},
};

function makeInput(command: string, response?: string): ToolHookInput {
  return {
    hook_type: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command },
    tool_response: response,
  };
}

describe("MessageQueueRelay", () => {
  test("has correct name and event", () => {
    expect(MessageQueueRelay.name).toBe("MessageQueueRelay");
    expect(MessageQueueRelay.event).toBe("PostToolUse");
  });

  describe("accepts", () => {
    test("accepts Bash tool inputs", () => {
      expect(MessageQueueRelay.accepts(makeInput("ls"))).toBe(true);
    });

    test("rejects non-Bash tool inputs", () => {
      const input: ToolHookInput = {
        hook_type: "PostToolUse",
        tool_name: "Read",
        tool_input: { file_path: "/tmp/test" },
      };
      expect(MessageQueueRelay.accepts(input)).toBe(false);
    });
  });

  describe("execute", () => {
    test("returns plain continue for non-watcher commands", () => {
      const result = MessageQueueRelay.execute(makeInput("git status"), mockDeps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("continue");
        expect(result.value.additionalContext).toBeUndefined();
      }
    });

    test("injects timeout context when watcher exits with no message", () => {
      const result = MessageQueueRelay.execute(
        makeInput("bun scripts/mq-watcher.ts --session abc123", ""),
        mockDeps,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe("continue");
        expect(result.value.additionalContext).toContain("Watcher Timeout");
        expect(result.value.additionalContext).toContain("abc123");
      }
    });

    test("relays raw text message from watcher", () => {
      const result = MessageQueueRelay.execute(
        makeInput("bun scripts/mq-watcher.ts --session abc123", "hello from another agent"),
        mockDeps,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.additionalContext).toContain("New Message Received");
        expect(result.value.additionalContext).toContain("hello from another agent");
        expect(result.value.additionalContext).toContain("respawn the watcher");
      }
    });

    test("relays JSON message with from field", () => {
      const msg = JSON.stringify({ from: "Ren", body: "PR ready for review" });
      const result = MessageQueueRelay.execute(
        makeInput("bun scripts/mq-watcher.ts --session abc123", msg),
        mockDeps,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.additionalContext).toContain("from Ren");
        expect(result.value.additionalContext).toContain("PR ready for review");
      }
    });

    test("includes session ID in respawn command", () => {
      const result = MessageQueueRelay.execute(
        makeInput("bun scripts/mq-watcher.ts --session my-session-id", "test"),
        mockDeps,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.additionalContext).toContain("--session my-session-id");
      }
    });

    test("uses placeholder when session ID not in command", () => {
      const result = MessageQueueRelay.execute(
        makeInput("bun scripts/mq-watcher.ts", "test"),
        mockDeps,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.additionalContext).toContain("<session_id>");
      }
    });
  });
});
