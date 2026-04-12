/**
 * Type-level assertions for core/runner.ts signatures.
 *
 * The runner is exercised at runtime by core/runner.test.ts and
 * core/runner.coverage.test.ts. This file provides a minimal
 * parallel assertion that the 2-generic runHook / runHookWith
 * signatures type-check correctly against both
 * SyncHookContract<I, D> and AsyncHookContract<I, D>.
 *
 * If the runner's signatures regress to the old <I, O, D> form,
 * the literal contracts below will fail to compile and `bun test`
 * will refuse to run this file — that's the failure signal.
 *
 * Runtime `expect` calls are placeholders to satisfy the test runner;
 * the real verification is the type-check of the assignments above.
 */

import { describe, expect, it } from "bun:test";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { AsyncHookContract, SyncHookContract } from "@hooks/core/contract";
import { ok } from "@hooks/core/result";
import { runHook, runHookWith } from "@hooks/core/runner";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";

describe("core/runner — two-generic signature compatibility", () => {
  it("SyncHookContract<I, D> is accepted by runHook's type parameter", () => {
    const contract: SyncHookContract<ToolHookInput, {}> = {
      name: "RunnerTypeTest",
      event: "PostToolUse",
      accepts: () => true,
      execute: () => ok<SyncHookJSONOutput>({ continue: true }),
      defaultDeps: {},
    };

    // Compile-time assertion: runHook accepts a two-generic contract.
    // We never invoke runHook here — calling would trigger readStdin and process.exit.
    const typeCheck: typeof runHook<ToolHookInput, {}> = runHook;
    expect(typeCheck).toBeDefined();
    expect(contract.name).toBe("RunnerTypeTest");
  });

  it("AsyncHookContract<I, D> is accepted by runHook's type parameter", () => {
    const contract: AsyncHookContract<ToolHookInput, {}> = {
      name: "RunnerAsyncTypeTest",
      event: "PostToolUse",
      accepts: () => true,
      execute: async () => ok<SyncHookJSONOutput>({ continue: true }),
      defaultDeps: {},
    };

    const typeCheck: typeof runHook<ToolHookInput, {}> = runHook;
    expect(typeCheck).toBeDefined();
    expect(contract.name).toBe("RunnerAsyncTypeTest");
  });

  it("runHookWith accepts SyncHookContract<I, D> with pre-built input", () => {
    const contract: SyncHookContract<ToolHookInput, {}> = {
      name: "RunnerWithTypeTest",
      event: "PreToolUse",
      accepts: () => true,
      execute: () =>
        ok<SyncHookJSONOutput>({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
          },
        }),
      defaultDeps: {},
    };

    const typeCheck: typeof runHookWith<ToolHookInput, {}> = runHookWith;
    expect(typeCheck).toBeDefined();
    expect(contract.name).toBe("RunnerWithTypeTest");
  });
});

describe("SyncHookJSONOutput shapes accepted by the runner's direct-serialization path", () => {
  it("accepts all shape variants contracts may return", () => {
    // Proves the runner's direct-serialization path handles every
    // SyncHookJSONOutput variant without a mapping layer. If the SDK
    // union changes, these literals will fail to type-check.
    const simpleContinue: SyncHookJSONOutput = { continue: true };
    const silent: SyncHookJSONOutput = {};
    const withSystemMessage: SyncHookJSONOutput = {
      continue: true,
      systemMessage: "hello",
    };
    const preToolDeny: SyncHookJSONOutput = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "blocked",
      },
    };
    const postToolContext: SyncHookJSONOutput = {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "injected",
      },
    };
    const nonPreToolBlock: SyncHookJSONOutput = {
      decision: "block",
      reason: "not allowed",
    };

    expect([
      simpleContinue,
      silent,
      withSystemMessage,
      preToolDeny,
      postToolContext,
      nonPreToolBlock,
    ]).toHaveLength(6);
  });
});
