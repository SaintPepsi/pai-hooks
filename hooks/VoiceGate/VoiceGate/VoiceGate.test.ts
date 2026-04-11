import { describe, expect, it } from "bun:test";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { VoiceGate, type VoiceGateDeps } from "@hooks/hooks/VoiceGate/VoiceGate/VoiceGate.contract";

function makeDeps(overrides: Partial<VoiceGateDeps> = {}): VoiceGateDeps {
  return {
    existsSync: () => false,
    getIsSubagent: () => false,
    ...overrides,
  };
}

function makeInput(command: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Bash",
    tool_input: { command },
  };
}

describe("VoiceGate", () => {
  it("has correct name and event", () => {
    expect(VoiceGate.name).toBe("VoiceGate");
    expect(VoiceGate.event).toBe("PreToolUse");
  });

  it("rejects non-voice commands via accepts()", () => {
    expect(VoiceGate.accepts(makeInput("git status"))).toBe(false);
    expect(VoiceGate.accepts(makeInput("echo hello"))).toBe(false);
  });

  it("accepts voice server commands", () => {
    expect(VoiceGate.accepts(makeInput("curl -s localhost:8888/notify"))).toBe(true);
  });

  it("allows voice request from main session", () => {
    const deps = makeDeps({ getIsSubagent: () => false });
    const result = VoiceGate.execute(makeInput("curl localhost:8888/notify"), deps);
    expect(result.ok).toBe(true);
    expect(result.value?.continue).toBe(true);
  });

  it("blocks voice request from subagent", () => {
    const deps = makeDeps({ getIsSubagent: () => true });
    const result = VoiceGate.execute(makeInput("curl localhost:8888/notify"), deps);
    expect(result.ok).toBe(true);
    const hs = result.value?.hookSpecificOutput;
    expect(hs?.hookEventName).toBe("PreToolUse");
    if (hs && hs.hookEventName === "PreToolUse") {
      expect(hs.permissionDecision).toBe("deny");
      expect(hs.permissionDecisionReason?.toLowerCase()).toContain("subagent");
    }
  });
});
