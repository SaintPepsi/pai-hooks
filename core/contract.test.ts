/**
 * Type-level assertions for the SDK-typed HookContract shape.
 *
 * contract.ts defines three pure interfaces with zero runtime behavior, so
 * these "tests" are compile-time satisfactions that force TypeScript to
 * verify the new two-generic signature accepts SyncHookJSONOutput-returning
 * execute functions. If any literal below fails to type-check, `bun test`
 * will refuse to run this file — that's the failure signal.
 *
 * Runtime `expect` calls are placeholders to satisfy the test runner;
 * the real verification is that the contract literals below type-check.
 */

import { describe, expect, it } from "bun:test";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { AsyncHookContract, HookContract, SyncHookContract } from "@hooks/core/contract";
import { ok } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";

// Shared deps type for the sample contracts below.
interface SampleDeps {
  readonly now: () => number;
}

describe("SyncHookContract", () => {
  it("accepts a two-generic <I, D> contract whose execute returns SyncHookJSONOutput", () => {
    const contract: SyncHookContract<ToolHookInput, SampleDeps> = {
      name: "SampleSync",
      event: "PreToolUse",
      accepts: () => true,
      defaultDeps: { now: () => 0 },
      execute: (_input, _deps) =>
        ok<SyncHookJSONOutput>({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
          },
        }),
    };

    expect(contract.name).toBe("SampleSync");
  });

  it("accepts the simplest SyncHookJSONOutput shape (continue-only)", () => {
    const contract: SyncHookContract<ToolHookInput, SampleDeps> = {
      name: "SampleContinue",
      event: "PostToolUse",
      accepts: () => true,
      defaultDeps: { now: () => 0 },
      execute: () => ok<SyncHookJSONOutput>({ continue: true }),
    };

    expect(contract.event).toBe("PostToolUse");
  });
});

describe("AsyncHookContract", () => {
  it("accepts a two-generic <I, D> contract whose execute returns Promise<SyncHookJSONOutput>", async () => {
    const contract: AsyncHookContract<ToolHookInput, SampleDeps> = {
      name: "SampleAsync",
      event: "PostToolUse",
      accepts: () => true,
      defaultDeps: { now: () => 0 },
      execute: async (_input, _deps) =>
        ok<SyncHookJSONOutput>({
          hookSpecificOutput: {
            hookEventName: "PostToolUse",
            additionalContext: "async worked",
          },
        }),
    };

    const result = await contract.execute({} as ToolHookInput, contract.defaultDeps);
    expect(result.ok).toBe(true);
  });
});

describe("HookContract (union)", () => {
  it("accepts both sync and async contracts", () => {
    const sync: SyncHookContract<ToolHookInput, SampleDeps> = {
      name: "S",
      event: "PreToolUse",
      accepts: () => true,
      defaultDeps: { now: () => 0 },
      execute: () => ok<SyncHookJSONOutput>({ continue: true }),
    };

    const async_: AsyncHookContract<ToolHookInput, SampleDeps> = {
      name: "A",
      event: "PostToolUse",
      accepts: () => true,
      defaultDeps: { now: () => 0 },
      execute: async () => ok<SyncHookJSONOutput>({ continue: true }),
    };

    // Assigning into HookContract<I, D> proves the union accepts both narrowed variants.
    const fromSync: HookContract<ToolHookInput, SampleDeps> = sync;
    const fromAsync: HookContract<ToolHookInput, SampleDeps> = async_;

    expect([fromSync.name, fromAsync.name]).toEqual(["S", "A"]);
  });

  it("defaults I to HookInput and D to unknown", () => {
    // Default-parameter form — proves both generics have sensible defaults.
    const contract: SyncHookContract = {
      name: "Defaults",
      event: "SessionStart",
      accepts: () => true,
      defaultDeps: undefined,
      execute: () => ok<SyncHookJSONOutput>({}),
    };

    expect(contract.defaultDeps).toBeUndefined();
  });
});
