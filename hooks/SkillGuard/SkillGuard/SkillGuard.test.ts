import { describe, it, expect } from "bun:test";
import { SkillGuard } from "@hooks/hooks/SkillGuard/SkillGuard/SkillGuard.contract";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";

function makeInput(skill: string): ToolHookInput {
  return {
    session_id: "test",
    tool_name: "Skill",
    tool_input: { skill },
  };
}

describe("SkillGuard", () => {
  it("has correct name and event", () => {
    expect(SkillGuard.name).toBe("SkillGuard");
    expect(SkillGuard.event).toBe("PreToolUse");
  });

  it("accepts all inputs (gate is in execute)", () => {
    expect(SkillGuard.accepts(makeInput("anything"))).toBe(true);
  });

  it("blocks keybindings-help", () => {
    const result = SkillGuard.execute(makeInput("keybindings-help"), {});
    expect(result.ok).toBe(true);
    expect(result.value?.type).toBe("block");
    if (result.ok && result.value.type === "block") {
      expect(result.value.reason).toContain("position bias");
    }
  });

  it("blocks case-insensitive", () => {
    const result = SkillGuard.execute(makeInput("Keybindings-Help"), {});
    expect(result.ok).toBe(true);
    expect(result.value?.type).toBe("block");
  });

  it("allows legitimate skills", () => {
    const result = SkillGuard.execute(makeInput("commit"), {});
    expect(result.ok).toBe(true);
    expect(result.value?.type).toBe("continue");
  });

  it("allows empty skill name", () => {
    const result = SkillGuard.execute(makeInput(""), {});
    expect(result.ok).toBe(true);
    expect(result.value?.type).toBe("continue");
  });
});
