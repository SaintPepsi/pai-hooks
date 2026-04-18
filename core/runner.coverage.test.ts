import { describe, expect, it } from "bun:test";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { HookContract } from "@hooks/core/contract";
import { ErrorCode, invalidInput, ResultError } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import { type RunHookOptions, runHook, runHookWith } from "@hooks/core/runner";
import type {
  HookInput,
  PermissionRequestInput,
  PreCompactInput,
  SessionEndInput,
  SessionStartInput,
  StopInput,
  SubagentStartInput,
  SubagentStopInput,
  ToolHookInput,
  UserPromptSubmitInput,
} from "@hooks/core/types/hook-inputs";

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

  it("exits 0 and emits { continue: true } when accepts() returns false for tool events", async () => {
    const contract: HookContract<ToolHookInput, {}> = {
      name: "TestReject",
      event: "PostToolUse",
      accepts: () => false,
      execute: () => ok({ continue: true }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, validToolInput, io);
    expect(io.stdoutLines.length).toBe(1);
    expect(JSON.parse(io.stdoutLines[0])).toEqual({ continue: true });
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
  it("produces no stdout for silent output on Stop contracts", async () => {
    const silentContract: HookContract<StopInput, {}> = {
      name: "TestSilentWith",
      event: "Stop",
      accepts: () => true,
      execute: () => ok({}),
      defaultDeps: {},
    };
    const validStopInput: StopInput = { session_id: "test-sess" };
    const io = createMockIO();
    await runHookWith(silentContract, validStopInput, io);
    expect(io.stdoutLines.length).toBe(0);
    expect(io.exitCode).toBe(0);
  });

  it("PostToolUse ok({}) normalizes to { continue: true } via runHookWith", async () => {
    const toolEmptyContract: HookContract<ToolHookInput, {}> = {
      name: "TestToolEmptyWith",
      event: "PostToolUse",
      accepts: () => true,
      execute: () => ok({}),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(toolEmptyContract, validToolInput, io);
    expect(io.stdoutLines.length).toBe(1);
    expect(JSON.parse(io.stdoutLines[0])).toEqual({ continue: true });
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

  it("skips duplicate in runHookWith and emits { continue: true } for tool events", async () => {
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
    expect(io.stdoutLines.length).toBe(1);
    expect(JSON.parse(io.stdoutLines[0])).toEqual({ continue: true });
  });
});

// ─── PermissionRequest Normalization Tests ───────────────────────────────────

describe("runHookWith — PermissionRequest ok({}) normalization", () => {
  it("PermissionRequest ok({}) normalizes to { continue: true }", async () => {
    const permContract: HookContract<PermissionRequestInput, {}> = {
      name: "TestPermissionRequest",
      event: "PermissionRequest",
      accepts: () => true,
      execute: () => ok({}),
      defaultDeps: {},
    };
    const validPermInput: PermissionRequestInput = {
      session_id: "test-sess",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    };
    const io = createMockIO();
    await runHookWith(permContract, validPermInput, io);
    expect(io.stdoutLines.length).toBe(1);
    expect(JSON.parse(io.stdoutLines[0])).toEqual({ continue: true });
    expect(io.exitCode).toBe(0);
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

// ─── runHookWith — event output matrix ───────────────────────────────────────

describe("runHookWith — event output matrix", () => {
  // ── SessionStart ──────────────────────────────────────────────────────────

  it("SessionStart: additionalContext flows through hookSpecificOutput", async () => {
    const contract: HookContract<SessionStartInput, {}> = {
      name: "TestSessionStartContext",
      event: "SessionStart",
      accepts: () => true,
      execute: () =>
        ok({
          hookSpecificOutput: {
            hookEventName: "SessionStart" as const,
            additionalContext: "hello from session",
          },
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, { session_id: "s1" }, io);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(output.hookSpecificOutput.additionalContext).toBe("hello from session");
    expect(io.exitCode).toBe(0);
  });

  it("SessionStart: watchPaths flows through hookSpecificOutput", async () => {
    const contract: HookContract<SessionStartInput, {}> = {
      name: "TestSessionStartWatch",
      event: "SessionStart",
      accepts: () => true,
      execute: () =>
        ok({
          hookSpecificOutput: {
            hookEventName: "SessionStart" as const,
            watchPaths: ["/tmp/foo", "/tmp/bar"],
          },
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, { session_id: "s1" }, io);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.watchPaths).toEqual(["/tmp/foo", "/tmp/bar"]);
    expect(io.exitCode).toBe(0);
  });

  it("SessionStart: initialUserMessage flows through hookSpecificOutput", async () => {
    const contract: HookContract<SessionStartInput, {}> = {
      name: "TestSessionStartMsg",
      event: "SessionStart",
      accepts: () => true,
      execute: () =>
        ok({
          hookSpecificOutput: {
            hookEventName: "SessionStart" as const,
            initialUserMessage: "start here",
          },
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, { session_id: "s1" }, io);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.initialUserMessage).toBe("start here");
    expect(io.exitCode).toBe(0);
  });

  // ── UserPromptSubmit ──────────────────────────────────────────────────────

  it("UserPromptSubmit: sessionTitle flows through hookSpecificOutput", async () => {
    const input: UserPromptSubmitInput = { session_id: "s2", prompt: "do the thing" };
    const contract: HookContract<UserPromptSubmitInput, {}> = {
      name: "TestUPSTitle",
      event: "UserPromptSubmit",
      accepts: () => true,
      execute: () =>
        ok({
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit" as const,
            sessionTitle: "My Session",
          },
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, input, io);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(output.hookSpecificOutput.sessionTitle).toBe("My Session");
    expect(io.exitCode).toBe(0);
  });

  it("UserPromptSubmit: additionalContext flows through hookSpecificOutput", async () => {
    const input: UserPromptSubmitInput = { session_id: "s2", prompt: "do the thing" };
    const contract: HookContract<UserPromptSubmitInput, {}> = {
      name: "TestUPSContext",
      event: "UserPromptSubmit",
      accepts: () => true,
      execute: () =>
        ok({
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit" as const,
            additionalContext: "injected context",
          },
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, input, io);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.additionalContext).toBe("injected context");
    expect(io.exitCode).toBe(0);
  });

  // ── Stop: top-level block ─────────────────────────────────────────────────

  it("Stop: decision:block at top level (no hookSpecificOutput)", async () => {
    const contract: HookContract<StopInput, {}> = {
      name: "TestStopBlock",
      event: "Stop",
      accepts: () => true,
      execute: () =>
        ok({
          decision: "block" as const,
          reason: "not yet done",
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, { session_id: "s3" }, io);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.decision).toBe("block");
    expect(output.reason).toBe("not yet done");
    expect(output.hookSpecificOutput).toBeUndefined();
    expect(io.exitCode).toBe(0);
  });

  // ── PermissionRequest ─────────────────────────────────────────────────────

  it("PermissionRequest: allow + updatedPermissions flows through", async () => {
    const input: PermissionRequestInput = {
      session_id: "s4",
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
    };
    const contract: HookContract<PermissionRequestInput, {}> = {
      name: "TestPermAllow",
      event: "PermissionRequest",
      accepts: () => true,
      execute: () =>
        ok({
          hookSpecificOutput: {
            hookEventName: "PermissionRequest" as const,
            decision: {
              behavior: "allow" as const,
              updatedPermissions: [
                {
                  type: "addRules" as const,
                  rules: [{ toolName: "Bash", ruleContent: "ls" }],
                  behavior: "allow" as const,
                  destination: "session" as const,
                },
              ],
            },
          },
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, input, io);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.hookEventName).toBe("PermissionRequest");
    expect(output.hookSpecificOutput.decision.behavior).toBe("allow");
    expect(output.hookSpecificOutput.decision.updatedPermissions[0].type).toBe("addRules");
    expect(io.exitCode).toBe(0);
  });

  it("PermissionRequest: deny + message flows through", async () => {
    const input: PermissionRequestInput = {
      session_id: "s4",
      tool_name: "Bash",
      tool_input: { command: "dangerous-command" },
    };
    const contract: HookContract<PermissionRequestInput, {}> = {
      name: "TestPermDeny",
      event: "PermissionRequest",
      accepts: () => true,
      execute: () =>
        ok({
          hookSpecificOutput: {
            hookEventName: "PermissionRequest" as const,
            decision: {
              behavior: "deny" as const,
              message: "dangerous command blocked",
            },
          },
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, input, io);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.decision.behavior).toBe("deny");
    expect(output.hookSpecificOutput.decision.message).toBe("dangerous command blocked");
    expect(io.exitCode).toBe(0);
  });

  // ── Setup / SubagentStart / Notification: additionalContext ───────────────

  it("Setup: additionalContext flows through hookSpecificOutput", async () => {
    const contract: HookContract<SessionStartInput, {}> = {
      name: "TestSetupContext",
      event: "SessionStart",
      accepts: () => true,
      execute: () =>
        ok({
          hookSpecificOutput: {
            hookEventName: "Setup" as const,
            additionalContext: "setup context",
          },
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, { session_id: "s5" }, io);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.hookEventName).toBe("Setup");
    expect(output.hookSpecificOutput.additionalContext).toBe("setup context");
    expect(io.exitCode).toBe(0);
  });

  it("SubagentStart: additionalContext flows through hookSpecificOutput", async () => {
    const input: SubagentStartInput = { session_id: "s6" };
    const contract: HookContract<SubagentStartInput, {}> = {
      name: "TestSubagentStartContext",
      event: "SubagentStart",
      accepts: () => true,
      execute: () =>
        ok({
          hookSpecificOutput: {
            hookEventName: "SubagentStart" as const,
            additionalContext: "subagent ctx",
          },
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, input, io);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.hookEventName).toBe("SubagentStart");
    expect(output.hookSpecificOutput.additionalContext).toBe("subagent ctx");
    expect(io.exitCode).toBe(0);
  });

  it("Notification: additionalContext flows through hookSpecificOutput", async () => {
    const contract: HookContract<SessionStartInput, {}> = {
      name: "TestNotificationContext",
      event: "SessionStart",
      accepts: () => true,
      execute: () =>
        ok({
          hookSpecificOutput: {
            hookEventName: "Notification" as const,
            additionalContext: "notify context",
          },
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, { session_id: "s7" }, io);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.hookEventName).toBe("Notification");
    expect(output.hookSpecificOutput.additionalContext).toBe("notify context");
    expect(io.exitCode).toBe(0);
  });

  // ── PostToolUseFailure ────────────────────────────────────────────────────

  it("PostToolUseFailure: hookSpecificOutput flows through on tool event", async () => {
    const contract: HookContract<ToolHookInput, {}> = {
      name: "TestPostToolUseFailure",
      event: "PostToolUse",
      accepts: () => true,
      execute: () =>
        ok({
          hookSpecificOutput: {
            hookEventName: "PostToolUseFailure" as const,
          },
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, validToolInput, io);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.hookEventName).toBe("PostToolUseFailure");
    expect(io.exitCode).toBe(0);
  });

  // ── PermissionDenied ──────────────────────────────────────────────────────

  it("PermissionDenied: retry:true flows through hookSpecificOutput", async () => {
    const contract: HookContract<SessionStartInput, {}> = {
      name: "TestPermDeniedRetry",
      event: "SessionStart",
      accepts: () => true,
      execute: () =>
        ok({
          hookSpecificOutput: {
            hookEventName: "PermissionDenied" as const,
            retry: true,
          },
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, { session_id: "s8" }, io);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.hookEventName).toBe("PermissionDenied");
    expect(output.hookSpecificOutput.retry).toBe(true);
    expect(io.exitCode).toBe(0);
  });

  // ── Elicitation ───────────────────────────────────────────────────────────

  it("Elicitation: action:accept + content flows through hookSpecificOutput", async () => {
    const contract: HookContract<SessionStartInput, {}> = {
      name: "TestElicitationAccept",
      event: "SessionStart",
      accepts: () => true,
      execute: () =>
        ok({
          hookSpecificOutput: {
            hookEventName: "Elicitation" as const,
            action: "accept" as const,
            content: { name: "Maple" },
          },
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, { session_id: "s9" }, io);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.hookEventName).toBe("Elicitation");
    expect(output.hookSpecificOutput.action).toBe("accept");
    expect(output.hookSpecificOutput.content.name).toBe("Maple");
    expect(io.exitCode).toBe(0);
  });

  // ── ElicitationResult ─────────────────────────────────────────────────────

  it("ElicitationResult: action:decline flows through hookSpecificOutput", async () => {
    const contract: HookContract<SessionStartInput, {}> = {
      name: "TestElicitationResultDecline",
      event: "SessionStart",
      accepts: () => true,
      execute: () =>
        ok({
          hookSpecificOutput: {
            hookEventName: "ElicitationResult" as const,
            action: "decline" as const,
          },
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, { session_id: "s10" }, io);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.hookEventName).toBe("ElicitationResult");
    expect(output.hookSpecificOutput.action).toBe("decline");
    expect(io.exitCode).toBe(0);
  });

  // ── CwdChanged / FileChanged: watchPaths ─────────────────────────────────

  it("CwdChanged: watchPaths flows through hookSpecificOutput", async () => {
    const contract: HookContract<SessionStartInput, {}> = {
      name: "TestCwdChanged",
      event: "SessionStart",
      accepts: () => true,
      execute: () =>
        ok({
          hookSpecificOutput: {
            hookEventName: "CwdChanged" as const,
            watchPaths: ["/new/cwd"],
          },
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, { session_id: "s11" }, io);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.hookEventName).toBe("CwdChanged");
    expect(output.hookSpecificOutput.watchPaths).toEqual(["/new/cwd"]);
    expect(io.exitCode).toBe(0);
  });

  it("FileChanged: watchPaths flows through hookSpecificOutput", async () => {
    const contract: HookContract<SessionStartInput, {}> = {
      name: "TestFileChanged",
      event: "SessionStart",
      accepts: () => true,
      execute: () =>
        ok({
          hookSpecificOutput: {
            hookEventName: "FileChanged" as const,
            watchPaths: ["/some/file.ts"],
          },
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, { session_id: "s12" }, io);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.hookEventName).toBe("FileChanged");
    expect(output.hookSpecificOutput.watchPaths).toEqual(["/some/file.ts"]);
    expect(io.exitCode).toBe(0);
  });

  // ── WorktreeCreate ────────────────────────────────────────────────────────

  it("WorktreeCreate: worktreePath flows through hookSpecificOutput", async () => {
    const contract: HookContract<SessionStartInput, {}> = {
      name: "TestWorktreeCreate",
      event: "SessionStart",
      accepts: () => true,
      execute: () =>
        ok({
          hookSpecificOutput: {
            hookEventName: "WorktreeCreate" as const,
            worktreePath: "/worktrees/feat-x",
          },
        }),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, { session_id: "s13" }, io);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.hookEventName).toBe("WorktreeCreate");
    expect(output.hookSpecificOutput.worktreePath).toBe("/worktrees/feat-x");
    expect(io.exitCode).toBe(0);
  });

  // ── Silent events: SessionEnd, PreCompact, SubagentStop ───────────────────

  it("SessionEnd: ok({}) produces no stdout (silent)", async () => {
    const input: SessionEndInput = { session_id: "s14" };
    const contract: HookContract<SessionEndInput, {}> = {
      name: "TestSessionEndSilent",
      event: "SessionEnd",
      accepts: () => true,
      execute: () => ok({}),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, input, io);
    expect(io.stdoutLines.length).toBe(0);
    expect(io.exitCode).toBe(0);
  });

  it("PreCompact: ok({}) produces no stdout (silent)", async () => {
    const input: PreCompactInput = { session_id: "s15" };
    const contract: HookContract<PreCompactInput, {}> = {
      name: "TestPreCompactSilent",
      event: "PreCompact",
      accepts: () => true,
      execute: () => ok({}),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, input, io);
    expect(io.stdoutLines.length).toBe(0);
    expect(io.exitCode).toBe(0);
  });

  it("SubagentStop: ok({}) produces no stdout (silent)", async () => {
    const input: SubagentStopInput = { session_id: "s16" };
    const contract: HookContract<SubagentStopInput, {}> = {
      name: "TestSubagentStopSilent",
      event: "SubagentStop",
      accepts: () => true,
      execute: () => ok({}),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHookWith(contract, input, io);
    expect(io.stdoutLines.length).toBe(0);
    expect(io.exitCode).toBe(0);
  });
});

// ─── resolveEvent fallback warning tests ────────────────────────────────────

describe("resolveEvent — fallback warning on parseHookInput failure", () => {
  // An input with no hook_type fails parseHookInput (schema requires hook_type literal)
  const ambiguousInput = JSON.stringify({ session_id: "s-warn" });

  it("emits stderr warning when multi-event contract receives input that fails parseHookInput", async () => {
    const contract: HookContract<HookInput, {}> = {
      name: "TestResolveWarn",
      event: ["SessionStart", "SessionEnd"],
      accepts: () => true,
      execute: () => ok({}),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHook(contract, { ...io, stdinOverride: ambiguousInput });
    expect(
      io.stderrLines.some(
        (l) =>
          l.includes("[TestResolveWarn]") &&
          l.includes("resolveEvent: parseHookInput failed") &&
          l.includes("SessionStart"),
      ),
    ).toBe(true);
  });

  it("returns contractEvent[0] as fallback — behavior unchanged", async () => {
    const contract: HookContract<HookInput, {}> = {
      name: "TestResolveWarnFallback",
      event: ["SessionStart", "SessionEnd"],
      accepts: () => true,
      execute: () => ok({}),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHook(contract, { ...io, stdinOverride: ambiguousInput });
    // Hook still completes (exit 0) — fallback did not break execution
    expect(io.exitCode).toBe(0);
  });

  it("does not emit resolveEvent warning when parseHookInput succeeds (Right path)", async () => {
    const contract: HookContract<HookInput, {}> = {
      name: "TestResolveNoWarn",
      event: ["SessionStart", "SessionEnd"],
      accepts: () => true,
      execute: () => ok({}),
      defaultDeps: {},
    };
    // Valid SessionStart input — parseHookInput returns Right
    const validInput = JSON.stringify({ session_id: "s-ok", hook_type: "SessionStart" });
    const io = createMockIO();
    await runHook(contract, { ...io, stdinOverride: validInput });
    expect(
      io.stderrLines.some((l) => l.includes("resolveEvent: parseHookInput failed")),
    ).toBe(false);
  });

  it("does not emit resolveEvent warning for single-event string contract", async () => {
    const contract: HookContract<HookInput, {}> = {
      name: "TestResolveNoWarnSingle",
      event: "SessionStart",
      accepts: () => true,
      execute: () => ok({}),
      defaultDeps: {},
    };
    // ambiguousInput fails parseHookInput, but single-event returns early before warn
    const io = createMockIO();
    await runHook(contract, { ...io, stdinOverride: ambiguousInput });
    expect(
      io.stderrLines.some((l) => l.includes("resolveEvent: parseHookInput failed")),
    ).toBe(false);
  });
});
