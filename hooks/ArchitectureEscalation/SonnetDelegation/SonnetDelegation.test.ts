import { describe, expect, it } from "bun:test";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { ResultError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { getInjectedContextFor } from "@hooks/lib/test-helpers";
import { SonnetDelegation, type SonnetDelegationDeps } from "./SonnetDelegation.contract";

function makeDeps(overrides: Partial<SonnetDelegationDeps> = {}): SonnetDelegationDeps {
  return {
    stderr: () => {},
    ...overrides,
  };
}

function makeToolInput(toolName: string, toolInput: Record<string, unknown> = {}): ToolHookInput {
  return {
    session_id: "test-session",
    tool_name: toolName,
    tool_input: toolInput,
  };
}

describe("SonnetDelegation", () => {
  it("has correct name and event", () => {
    expect(SonnetDelegation.name).toBe("SonnetDelegation");
    expect(SonnetDelegation.event).toBe("PostToolUse");
  });

  it("accepts Skill tool when skill is superpowers:executing-plans", () => {
    expect(
      SonnetDelegation.accepts(makeToolInput("Skill", { skill: "superpowers:executing-plans" })),
    ).toBe(true);
  });

  it("accepts Skill tool when skill is executing-plans (without prefix)", () => {
    expect(SonnetDelegation.accepts(makeToolInput("Skill", { skill: "executing-plans" }))).toBe(
      true,
    );
  });

  it("rejects Skill tool for other skills", () => {
    expect(SonnetDelegation.accepts(makeToolInput("Skill", { skill: "Research" }))).toBe(false);
    expect(
      SonnetDelegation.accepts(makeToolInput("Skill", { skill: "superpowers:brainstorming" })),
    ).toBe(false);
  });

  it("rejects non-Skill tools", () => {
    expect(SonnetDelegation.accepts(makeToolInput("Edit"))).toBe(false);
    expect(SonnetDelegation.accepts(makeToolInput("Bash"))).toBe(false);
    expect(SonnetDelegation.accepts(makeToolInput("Read"))).toBe(false);
  });

  it("rejects Skill tool with string tool_input", () => {
    const input: ToolHookInput = {
      session_id: "test-session",
      tool_name: "Skill",
      tool_input: "executing-plans" as unknown as Record<string, unknown>,
    };
    expect(SonnetDelegation.accepts(input)).toBe(false);
  });

  it("rejects Skill tool with null tool_input", () => {
    const input: ToolHookInput = {
      session_id: "test-session",
      tool_name: "Skill",
      tool_input: null as unknown as Record<string, unknown>,
    };
    expect(SonnetDelegation.accepts(input)).toBe(false);
  });

  it("returns additionalContext with delegation guidance", () => {
    const deps = makeDeps();
    const result = SonnetDelegation.execute(
      makeToolInput("Skill", { skill: "superpowers:executing-plans" }),
      deps,
    ) as Result<SyncHookJSONOutput, ResultError>;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
    expect(getInjectedContextFor(result.value, "PostToolUse")).toBeDefined();
  });

  it("guidance mentions Sonnet delegation", () => {
    const deps = makeDeps();
    const result = SonnetDelegation.execute(
      makeToolInput("Skill", { skill: "superpowers:executing-plans" }),
      deps,
    ) as Result<SyncHookJSONOutput, ResultError>;

    if (!result.ok) return;
    const ctx = getInjectedContextFor(result.value, "PostToolUse") ?? "";
    expect(ctx).toContain("sonnet");
    expect(ctx).toContain("mechanical");
  });

  it("guidance contains anti-requirements", () => {
    const deps = makeDeps();
    const result = SonnetDelegation.execute(
      makeToolInput("Skill", { skill: "superpowers:executing-plans" }),
      deps,
    ) as Result<SyncHookJSONOutput, ResultError>;

    if (!result.ok) return;
    const ctx = getInjectedContextFor(result.value, "PostToolUse") ?? "";
    expect(ctx).toContain("NEVER");
    expect(ctx).toContain("ISC");
    expect(ctx).toContain("PRD");
    expect(ctx).toContain("verif");
  });

  it("logs to stderr on execute", () => {
    let logged = "";
    const deps = makeDeps({
      stderr: (msg: string) => {
        logged = msg;
      },
    });
    SonnetDelegation.execute(
      makeToolInput("Skill", { skill: "superpowers:executing-plans" }),
      deps,
    );
    expect(logged).toContain("SonnetDelegation");
  });
});
