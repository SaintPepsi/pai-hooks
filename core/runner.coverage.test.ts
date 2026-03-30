import { describe, expect, it } from "bun:test";
import type { HookContract } from "@hooks/core/contract";
import { ErrorCode, invalidInput, PaiError } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import { type RunHookOptions, runHook, runHookWith } from "@hooks/core/runner";
import type { SessionStartInput, ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { AskOutput, BlockOutput, ContinueOutput } from "@hooks/core/types/hook-outputs";

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
    const contract: HookContract<ToolHookInput, ContinueOutput, {}> = {
      name: "TestDirect",
      event: "PostToolUse",
      accepts: () => true,
      execute: () => ok({ type: "continue", continue: true as const, additionalContext: "direct" }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, validToolInput, io);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.additionalContext).toBe("direct");
    expect(io.exitCode).toBe(0);
  });

  it("exits 0 when accepts() returns false", async () => {
    const contract: HookContract<ToolHookInput, ContinueOutput, {}> = {
      name: "TestReject",
      event: "PostToolUse",
      accepts: () => false,
      execute: () => ok({ type: "continue", continue: true as const }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, validToolInput, io);
    expect(io.stdoutLines.length).toBe(0);
    expect(io.exitCode).toBe(0);
  });

  it("logs error and exits 0 when execute returns error", async () => {
    const contract: HookContract<ToolHookInput, ContinueOutput, {}> = {
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
    const contract: HookContract<ToolHookInput, ContinueOutput, {}> = {
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
    const contract: HookContract<ToolHookInput, ContinueOutput, {}> = {
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
    const securityContract: HookContract<ToolHookInput, ContinueOutput, {}> = {
      name: "TestSecurity",
      event: "PreToolUse",
      accepts: () => true,
      execute: () => err(new PaiError(ErrorCode.SecurityBlock, "blocked for security")),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHook(securityContract, { ...io, stdinOverride: validToolInputJson });
    expect(io.exitCode).toBe(2);
    expect(io.stderrLines.some((l) => l.includes("blocked for security"))).toBe(true);
  });

  it("exits 0 for non-SecurityBlock errors (fail open)", async () => {
    const normalError: HookContract<ToolHookInput, ContinueOutput, {}> = {
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
    const preToolContract: HookContract<ToolHookInput, ContinueOutput, {}> = {
      name: "TestPreTool",
      event: "PreToolUse",
      accepts: () => true,
      execute: () => ok({ type: "continue", continue: true as const }),
      defaultDeps: {},
    };
    const inputMissingToolName = JSON.stringify({ session_id: "s" });
    const io = createMockIO();
    await runHook(preToolContract, { ...io, stdinOverride: inputMissingToolName });
    expect(io.stderrLines.some((l) => l.includes("missing tool_name"))).toBe(true);
    expect(io.exitCode).toBe(0);
  });

  it("catches missing tool_name for PostToolUse contract", async () => {
    const postToolContract: HookContract<ToolHookInput, ContinueOutput, {}> = {
      name: "TestPostTool",
      event: "PostToolUse",
      accepts: () => true,
      execute: () => ok({ type: "continue", continue: true as const }),
      defaultDeps: {},
    };
    const inputMissingToolName = JSON.stringify({ session_id: "s" });
    const io = createMockIO();
    await runHook(postToolContract, { ...io, stdinOverride: inputMissingToolName });
    expect(io.stderrLines.some((l) => l.includes("missing tool_name"))).toBe(true);
  });

  it("does not flag missing tool_name for non-tool events", async () => {
    const sessionContract: HookContract<SessionStartInput, ContinueOutput, {}> = {
      name: "TestSession",
      event: "SessionStart",
      accepts: () => true,
      execute: () => ok({ type: "continue", continue: true as const }),
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
    const postBlocker: HookContract<ToolHookInput, BlockOutput, {}> = {
      name: "TestPostBlock",
      event: "PostToolUse",
      accepts: () => true,
      execute: () => ok({ type: "block", decision: "block" as const, reason: "post-block reason" }),
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
  it("produces decision/message JSON for ask output", async () => {
    const asker: HookContract<ToolHookInput, AskOutput, {}> = {
      name: "TestAsker",
      event: "PreToolUse",
      accepts: () => true,
      execute: () => ok({ type: "ask", decision: "ask" as const, message: "are you sure?" }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHook(asker, { ...io, stdinOverride: validToolInputJson });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.decision).toBe("ask");
    expect(output.message).toBe("are you sure?");
  });
});

// ─── runHookWith — silent and null output ────────────────────────────────────

describe("runHookWith — output edge cases", () => {
  it("produces no stdout for silent output", async () => {
    const silentContract: HookContract<ToolHookInput, { type: "silent" }, {}> = {
      name: "TestSilentWith",
      event: "Stop",
      accepts: () => true,
      execute: () => ok({ type: "silent" as const }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(silentContract, validToolInput, io);
    expect(io.stdoutLines.length).toBe(0);
    expect(io.exitCode).toBe(0);
  });

  it("formats updatedInput output type", async () => {
    const contract: HookContract<ToolHookInput, { type: "updatedInput"; updatedInput: Record<string, unknown> }, {}> = {
      name: "TestUpdatedInput",
      event: "PreToolUse",
      accepts: () => true,
      execute: () => ok({ type: "updatedInput" as const, updatedInput: { command: "ls -la" } }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, validToolInput, io);
    expect(io.exitCode).toBe(0);
    const parsed = JSON.parse(io.stdoutLines[0]);
    expect(parsed.hookSpecificOutput.updatedInput.command).toBe("ls -la");
  });

  it("skips duplicate in runHookWith", async () => {
    const contract: HookContract<ToolHookInput, ContinueOutput, {}> = {
      name: "TestDedupWith",
      event: "PostToolUse",
      accepts: () => true,
      execute: () => ok({ type: "continue", continue: true as const }),
      defaultDeps: {},
    };
    const io = createMockIO();
    (io as RunHookOptions).isDuplicate = () => true;
    await runHookWith(contract, validToolInput, io);
    expect(io.exitCode).toBe(0);
    expect(io.stdoutLines.length).toBe(0);
  });
});

// ─── runHook — additional branches ──────────────────────────────────────────

describe("runHook — stdin and dedup branches", () => {
  it("handles stdin read error gracefully", async () => {
    const contract: HookContract<ToolHookInput, ContinueOutput, {}> = {
      name: "TestStdinErr",
      event: "PreToolUse",
      accepts: () => true,
      execute: () => ok({ type: "continue", continue: true as const }),
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
    const contract: HookContract<ToolHookInput, ContinueOutput, {}> = {
      name: "TestDedupMain",
      event: "PreToolUse",
      accepts: () => true,
      execute: () => ok({ type: "continue", continue: true as const }),
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
