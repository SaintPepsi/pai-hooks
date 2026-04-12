import { describe, expect, it } from "bun:test";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { HookContract } from "@hooks/core/contract";
import { ErrorCode, invalidInput, ResultError } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import { type RunHookOptions, runHook, runHookWith } from "@hooks/core/runner";
import type { SessionStartInput, ToolHookInput } from "@hooks/core/types/hook-inputs";

// ─── Test Helpers ────────────────────────────────────────────────────────────

interface MockIO {
  stdoutLines: string[];
  stderrLines: string[];
  exitCode: number | null;
}

function createMockIO(): MockIO & RunHookOptions {
  const io: MockIO = { stdoutLines: [], stderrLines: [], exitCode: null };
  return {
    ...io,
    stdout: (msg: string) => {
      io.stdoutLines.push(msg);
    },
    stderr: (msg: string) => {
      io.stderrLines.push(msg);
    },
    exit: (code: number) => {
      io.exitCode = code;
    },
    isDuplicate: () => false,
    get stdoutLines() {
      return io.stdoutLines;
    },
    get stderrLines() {
      return io.stderrLines;
    },
    get exitCode() {
      return io.exitCode;
    },
  };
}

const validToolInput: ToolHookInput = {
  session_id: "test-sess",
  tool_name: "Edit",
  tool_input: { file: "test.ts" },
};

const validToolInputJson = JSON.stringify(validToolInput);

// ─── runHookWith Tests ───────────────────────────────────────────────────────

describe("runHookWith — pre-built input pipeline", () => {
  it("runs contract with pre-built input, skipping stdin", async () => {
    const contract: HookContract<ToolHookInput, {}> = {
      name: "TestDirect",
      event: "PostToolUse",
      accepts: () => true,
      execute: () =>
        ok({
          hookSpecificOutput: {
            hookEventName: "PostToolUse" as const,
            additionalContext: "direct",
          },
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, validToolInput, io);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.additionalContext).toBe("direct");
    expect(io.exitCode).toBe(0);
  });

  it("exits 0 when accepts() returns false", async () => {
    const contract: HookContract<ToolHookInput, {}> = {
      name: "TestReject",
      event: "PostToolUse",
      accepts: () => false,
      execute: () => ok({ continue: true }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, validToolInput, io);
    expect(io.stdoutLines.length).toBe(0);
    expect(io.exitCode).toBe(0);
  });

  it("logs error and exits 0 when execute returns error", async () => {
    const contract: HookContract<ToolHookInput, {}> = {
      name: "TestErrResult",
      event: "PostToolUse",
      accepts: () => true,
      execute: () => err(invalidInput("bad field")),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, validToolInput, io);
    expect(io.stderrLines.some((l) => l.includes("bad field"))).toBe(true);
    expect(io.exitCode).toBe(0);
  });

  it("catches thrown exceptions and exits 0", async () => {
    const contract: HookContract<ToolHookInput, {}> = {
      name: "TestThrow",
      event: "PostToolUse",
      accepts: () => true,
      execute: () => {
        throw new Error("unexpected boom");
      },
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, validToolInput, io);
    expect(io.stderrLines.some((l) => l.includes("unexpected boom"))).toBe(true);
    expect(io.exitCode).toBe(0);
  });

  it("catches non-Error thrown values", async () => {
    const contract: HookContract<ToolHookInput, {}> = {
      name: "TestThrowString",
      event: "PostToolUse",
      accepts: () => true,
      execute: () => {
        throw "string error";
      },
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, validToolInput, io);
    expect(io.stderrLines.some((l) => l.includes("string error"))).toBe(true);
    expect(io.exitCode).toBe(0);
  });
});

// ─── SecurityBlock Exit Code Tests ───────────────────────────────────────────

describe("runHook — SecurityBlock exit code 2", () => {
  it("exits with code 2 when error has SecurityBlock code", async () => {
    const securityContract: HookContract<ToolHookInput, {}> = {
      name: "TestSecurity",
      event: "PreToolUse",
      accepts: () => true,
      execute: () => err(new ResultError(ErrorCode.SecurityBlock, "blocked for security")),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHook(securityContract, {
      ...io,
      stdinOverride: validToolInputJson,
    });
    expect(io.exitCode).toBe(2);
    expect(io.stderrLines.some((l) => l.includes("blocked for security"))).toBe(true);
  });

  it("exits 0 for non-SecurityBlock errors (fail open)", async () => {
    const normalError: HookContract<ToolHookInput, {}> = {
      name: "TestNormalErr",
      event: "PreToolUse",
      accepts: () => true,
      execute: () => err(invalidInput("just a normal error")),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHook(normalError, { ...io, stdinOverride: validToolInputJson });
    expect(io.exitCode).toBe(0);
  });
});

// ─── tool_name Validation Tests ──────────────────────────────────────────────

describe("runHook — tool_name validation for tool events", () => {
  it("catches missing tool_name for PreToolUse contract", async () => {
    const preToolContract: HookContract<ToolHookInput, {}> = {
      name: "TestPreTool",
      event: "PreToolUse",
      accepts: () => true,
      execute: () => ok({ continue: true }),
      defaultDeps: {},
    };
    const inputMissingToolName = JSON.stringify({ session_id: "s" });
    const io = createMockIO();
    await runHook(preToolContract, {
      ...io,
      stdinOverride: inputMissingToolName,
    });
    expect(io.stderrLines.some((l) => l.includes("missing tool_name"))).toBe(true);
    expect(io.exitCode).toBe(0);
  });

  it("catches missing tool_name for PostToolUse contract", async () => {
    const postToolContract: HookContract<ToolHookInput, {}> = {
      name: "TestPostTool",
      event: "PostToolUse",
      accepts: () => true,
      execute: () => ok({ continue: true }),
      defaultDeps: {},
    };
    const inputMissingToolName = JSON.stringify({ session_id: "s" });
    const io = createMockIO();
    await runHook(postToolContract, {
      ...io,
      stdinOverride: inputMissingToolName,
    });
    expect(io.stderrLines.some((l) => l.includes("missing tool_name"))).toBe(true);
  });

  it("does not flag missing tool_name for non-tool events", async () => {
    const sessionContract: HookContract<SessionStartInput, {}> = {
      name: "TestSession",
      event: "SessionStart",
      accepts: () => true,
      execute: () => ok({ continue: true }),
      defaultDeps: {},
    };
    const sessionInput = JSON.stringify({ session_id: "s" });
    const io = createMockIO();
    await runHook(sessionContract, { ...io, stdinOverride: sessionInput });
    expect(io.stderrLines.length).toBe(0);
    expect(io.exitCode).toBe(0);
  });
});

// ─── Output Format Tests ────────────────────────────────────────────────────

describe("runHook — PostToolUse block format", () => {
  it("uses decision/reason format for non-PreToolUse block", async () => {
    const postBlocker: HookContract<ToolHookInput, {}> = {
      name: "TestPostBlock",
      event: "PostToolUse",
      accepts: () => true,
      execute: () =>
        ok({
          decision: "block" as const,
          reason: "post-block reason",
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHook(postBlocker, { ...io, stdinOverride: validToolInputJson });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.decision).toBe("block");
    expect(output.reason).toBe("post-block reason");
    // Should NOT have hookSpecificOutput wrapping
    expect(output.hookSpecificOutput).toBeUndefined();
  });
});

describe("runHook — ask output format", () => {
  it("produces hookSpecificOutput ask permissionDecision for PreToolUse ask", async () => {
    const asker: HookContract<ToolHookInput, {}> = {
      name: "TestAsker",
      event: "PreToolUse",
      accepts: () => true,
      execute: () =>
        ok({
          hookSpecificOutput: {
            hookEventName: "PreToolUse" as const,
            permissionDecision: "ask" as const,
            permissionDecisionReason: "are you sure?",
          },
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHook(asker, { ...io, stdinOverride: validToolInputJson });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(output.hookSpecificOutput.permissionDecision).toBe("ask");
    expect(output.hookSpecificOutput.permissionDecisionReason).toBe("are you sure?");
  });
});

// ─── runHookWith — silent and updatedInput output ────────────────────────────

describe("runHookWith — output edge cases", () => {
  it("produces no stdout for silent output", async () => {
    const silentContract: HookContract<ToolHookInput, {}> = {
      name: "TestSilentWith",
      event: "Stop",
      accepts: () => true,
      execute: () => ok({}),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(silentContract, validToolInput, io);
    expect(io.stdoutLines.length).toBe(0);
    expect(io.exitCode).toBe(0);
  });

  it("formats updatedInput output type", async () => {
    const contract: HookContract<ToolHookInput, {}> = {
      name: "TestUpdatedInput",
      event: "PreToolUse",
      accepts: () => true,
      execute: () =>
        ok({
          hookSpecificOutput: {
            hookEventName: "PreToolUse" as const,
            updatedInput: { command: "ls -la" },
          },
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, validToolInput, io);
    expect(io.exitCode).toBe(0);
    const parsed = JSON.parse(io.stdoutLines[0]);
    expect(parsed.hookSpecificOutput.updatedInput.command).toBe("ls -la");
  });

  it("skips duplicate in runHookWith", async () => {
    const contract: HookContract<ToolHookInput, {}> = {
      name: "TestDedupWith",
      event: "PostToolUse",
      accepts: () => true,
      execute: () => ok({ continue: true }),
      defaultDeps: {},
    };
    const io = createMockIO();
    (io as RunHookOptions).isDuplicate = () => true;
    await runHookWith(contract, validToolInput, io);
    expect(io.exitCode).toBe(0);
    expect(io.stdoutLines.length).toBe(0);
  });
});

// ─── Output Validation Failure Tests ────────────────────────────────────────

// Construct an output that is structurally invalid per the Effect schema
// (unrecognized hookEventName fails the hookSpecificOutput union) but passes
// TypeScript by casting through the SDK's SyncHookJSONOutput type.
// This is the correct intermediate-type cast pattern per TypeStrictness guidance.
const invalidSchemaOutput = {
  hookSpecificOutput: { hookEventName: "UnknownEvent" },
} as unknown as SyncHookJSONOutput;

describe("runHook — output validation failure (fail-open path)", () => {
  it("writes { continue: true } to stdout when validateHookOutput fails", async () => {
    const badOutputContract: HookContract<ToolHookInput, {}> = {
      name: "TestBadOutput",
      event: "PostToolUse",
      accepts: () => true,
      execute: () => ok(invalidSchemaOutput),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHook(badOutputContract, { ...io, stdinOverride: validToolInputJson });
    expect(io.stdoutLines.length).toBe(1);
    expect(JSON.parse(io.stdoutLines[0])).toEqual({ continue: true });
    expect(io.exitCode).toBe(0);
  });

  it("emits stderr warning when validateHookOutput fails", async () => {
    const badOutputContract: HookContract<ToolHookInput, {}> = {
      name: "TestBadOutputWarn",
      event: "PostToolUse",
      accepts: () => true,
      execute: () => ok(invalidSchemaOutput),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHook(badOutputContract, { ...io, stdinOverride: validToolInputJson });
    expect(io.stderrLines.some((l) => l.includes("output validation failed"))).toBe(true);
  });
});

// ─── Semantic Validation Warning Tests ──────────────────────────────────────

describe("runHook — semantic validation warning (warn-and-pass-through)", () => {
  it("emits stderr warning for continue:true + decision:block contradiction", async () => {
    const contradictoryContract: HookContract<ToolHookInput, {}> = {
      name: "TestSemanticWarn",
      event: "PostToolUse",
      accepts: () => true,
      execute: () =>
        ok({
          continue: true,
          decision: "block" as const,
          reason: "some reason",
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHook(contradictoryContract, { ...io, stdinOverride: validToolInputJson });
    expect(io.stderrLines.some((l) => l.includes("semantic validation warning"))).toBe(true);
    expect(io.stderrLines.some((l) => l.includes("mutually exclusive"))).toBe(true);
  });

  it("passes the original output through unchanged despite contradiction", async () => {
    const contradictoryContract: HookContract<ToolHookInput, {}> = {
      name: "TestSemanticPassThrough",
      event: "PostToolUse",
      accepts: () => true,
      execute: () =>
        ok({
          continue: true,
          decision: "block" as const,
          reason: "pass through me",
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHook(contradictoryContract, { ...io, stdinOverride: validToolInputJson });
    expect(io.stdoutLines.length).toBe(1);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.continue).toBe(true);
    expect(output.decision).toBe("block");
    expect(output.reason).toBe("pass through me");
    expect(io.exitCode).toBe(0);
  });

  it("does not emit semantic warning for a valid output", async () => {
    const validContract: HookContract<ToolHookInput, {}> = {
      name: "TestSemanticClean",
      event: "PostToolUse",
      accepts: () => true,
      execute: () =>
        ok({
          decision: "block" as const,
          reason: "clean block",
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHook(validContract, { ...io, stdinOverride: validToolInputJson });
    expect(io.stderrLines.some((l) => l.includes("semantic validation warning"))).toBe(false);
    expect(io.exitCode).toBe(0);
  });
});

// ─── runHook — additional branches ──────────────────────────────────────────

describe("runHook — stdin and dedup branches", () => {
  it("handles stdin read error gracefully", async () => {
    const contract: HookContract<ToolHookInput, {}> = {
      name: "TestStdinErr",
      event: "PreToolUse",
      accepts: () => true,
      execute: () => ok({ continue: true }),
      defaultDeps: {},
    };
    const io = createMockIO();
    // Provide invalid stdin that will fail parsing
    (io as RunHookOptions).stdinOverride = undefined;
    (io as RunHookOptions).stdinTimeout = 1; // 1ms timeout to force stdin error
    await runHook(contract, io as RunHookOptions);
    expect(io.exitCode).toBe(0);
    // Should output continue:true from safeExit for tool events
    expect(io.stdoutLines.some((s) => s.includes("continue"))).toBe(true);
  });

  it("skips duplicate in runHook", async () => {
    const contract: HookContract<ToolHookInput, {}> = {
      name: "TestDedupMain",
      event: "PreToolUse",
      accepts: () => true,
      execute: () => ok({ continue: true }),
      defaultDeps: {},
    };
    const io = createMockIO();
    (io as RunHookOptions).isDuplicate = () => true;
    (io as RunHookOptions).stdinOverride = validToolInputJson;
    await runHook(contract, io as RunHookOptions);
    expect(io.exitCode).toBe(0);
    // Dedup skip for tool events emits continue:true via safeExit
    expect(io.stdoutLines.some((s) => s.includes("continue"))).toBe(true);
  });
});
