import { describe, expect, it } from "bun:test";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { SkillGuard } from "@hooks/hooks/SkillGuard/SkillGuard/SkillGuard.contract";

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
    const hs = result.value?.hookSpecificOutput;
    if (hs?.hookEventName === "PreToolUse") {
      expect(hs.permissionDecision).toBe("deny");
      expect(hs.permissionDecisionReason).toContain("position bias");
    } else {
      throw new Error("expected PreToolUse hookSpecificOutput");
    }
  });

  it("blocks case-insensitive", () => {
    const result = SkillGuard.execute(makeInput("Keybindings-Help"), {});
    expect(result.ok).toBe(true);
    const hs = result.value?.hookSpecificOutput;
    if (hs?.hookEventName === "PreToolUse") {
      expect(hs.permissionDecision).toBe("deny");
    } else {
      throw new Error("expected PreToolUse hookSpecificOutput");
    }
  });

  it("allows legitimate skills", () => {
    const result = SkillGuard.execute(makeInput("commit"), {});
    expect(result.ok).toBe(true);
    expect(result.value?.continue).toBe(true);
  });

  it("allows empty skill name", () => {
    const result = SkillGuard.execute(makeInput(""), {});
    expect(result.ok).toBe(true);
    expect(result.value?.continue).toBe(true);
  });
});
