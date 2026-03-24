import { describe, it, expect } from "bun:test";
import { VoiceGate, type VoiceGateDeps } from "@hooks/hooks/VoiceGate/VoiceGate/VoiceGate.contract";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";

function makeDeps(overrides: Partial<VoiceGateDeps> = {}): VoiceGateDeps {
  return {
    existsSync: () => false,
    getTermProgram: () => "iTerm.app",
    getItermSessionId: () => undefined,
    getPaiDir: () => "/tmp/test-pai",
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

  it("accepts voice curl commands", () => {
    expect(VoiceGate.accepts(makeInput('curl -s localhost:8888/notify'))).toBe(true);
  });

  it("allows voice curl from main session (terminal detected)", () => {
    const deps = makeDeps({ getTermProgram: () => "iTerm.app" });
    const result = VoiceGate.execute(makeInput('curl localhost:8888'), deps);
    expect(result.ok).toBe(true);
    expect(result.value?.type).toBe("continue");
  });

  it("blocks voice curl from subagent (no terminal)", () => {
    // When kitty sessions dir doesn't exist, defaults to allowing
    // Let's make it exist but session file missing
    const deps2 = makeDeps({
      getTermProgram: () => undefined,
      getItermSessionId: () => undefined,
      existsSync: (path: string) => path.endsWith("kitty-sessions"),
    });
    const result = VoiceGate.execute(makeInput('curl localhost:8888'), deps2);
    expect(result.ok).toBe(true);
    expect(result.value?.type).toBe("block");
    if (result.ok && result.value.type === "block") {
      expect(result.value.reason.toLowerCase()).toContain("subagent");
    }
  });

  it("allows when iTerm session ID present", () => {
    const deps = makeDeps({
      getTermProgram: () => undefined,
      getItermSessionId: () => "some-session",
    });
    const result = VoiceGate.execute(makeInput('curl localhost:8888'), deps);
    expect(result.ok).toBe(true);
    expect(result.value?.type).toBe("continue");
  });
});
