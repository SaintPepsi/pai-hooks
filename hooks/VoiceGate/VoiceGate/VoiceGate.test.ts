import { describe, it, expect } from "bun:test";
import { VoiceGate, type VoiceGateDeps } from "@hooks/hooks/VoiceGate/VoiceGate/VoiceGate.contract";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";

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
    expect(VoiceGate.accepts(makeInput('curl -s localhost:8888/notify'))).toBe(true);
  });

  it("allows voice request from main session", () => {
    const deps = makeDeps({ getIsSubagent: () => false });
    const result = VoiceGate.execute(makeInput('curl localhost:8888/notify'), deps);
    expect(result.ok).toBe(true);
    expect(result.value?.type).toBe("continue");
  });

  it("blocks voice request from subagent", () => {
    const deps = makeDeps({ getIsSubagent: () => true });
    const result = VoiceGate.execute(makeInput('curl localhost:8888/notify'), deps);
    expect(result.ok).toBe(true);
    expect(result.value?.type).toBe("block");
    if (result.ok && result.value.type === "block") {
      expect(result.value.reason.toLowerCase()).toContain("subagent");
    }
  });
});
