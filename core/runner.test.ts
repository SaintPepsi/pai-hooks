import { describe, expect, it } from "bun:test";
import type { HookContract } from "./contract";
import { invalidInput } from "./error";
import { err, ok } from "./result";
import { type RunHookOptions, runHook } from "./runner";
import type { StopInput, ToolHookInput } from "./types/hook-inputs";

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

// Simple contract that always continues
const alwaysContinue: HookContract<ToolHookInput, {}> = {
  name: "TestContinue",
  event: "PostToolUse",
  accepts: () => true,
  execute: () => ok({ continue: true }),
  defaultDeps: {},
};

// Contract that adds context via hookSpecificOutput
const withContext: HookContract<ToolHookInput, {}> = {
  name: "TestContext",
  event: "PostToolUse",
  accepts: (input) => input.tool_name === "TaskUpdate",
  execute: () =>
    ok({
      hookSpecificOutput: {
        hookEventName: "PostToolUse" as const,
        additionalContext: "extra info",
      },
    }),
  defaultDeps: {},
};

// Contract that returns empty-string context (regression test)
const withEmptyContext: HookContract<ToolHookInput, {}> = {
  name: "TestEmptyContext",
  event: "PostToolUse",
  accepts: () => true,
  execute: () =>
    ok({
      hookSpecificOutput: {
        hookEventName: "PostToolUse" as const,
        additionalContext: "",
      },
    }),
  defaultDeps: {},
};

// Contract that blocks via hookSpecificOutput permissionDecision
const blocker: HookContract<ToolHookInput, {}> = {
  name: "TestBlocker",
  event: "PreToolUse",
  accepts: () => true,
  execute: () =>
    ok({
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "deny" as const,
        permissionDecisionReason: "not allowed",
      },
    }),
  defaultDeps: {},
};

// Contract that returns error
const failing: HookContract<ToolHookInput, {}> = {
  name: "TestFailing",
  event: "PostToolUse",
  accepts: () => true,
  execute: () => err(invalidInput("bad data")),
  defaultDeps: {},
};

// Contract that rejects via accepts()
const selective: HookContract<ToolHookInput, {}> = {
  name: "TestSelective",
  event: "PostToolUse",
  accepts: (input) => input.tool_name === "SpecificTool",
  execute: () =>
    ok({
      hookSpecificOutput: {
        hookEventName: "PostToolUse" as const,
        additionalContext: "accepted",
      },
    }),
  defaultDeps: {},
};

// Async contract
const asyncContract: HookContract<ToolHookInput, {}> = {
  name: "TestAsync",
  event: "PostToolUse",
  accepts: () => true,
  execute: async () =>
    ok({
      hookSpecificOutput: {
        hookEventName: "PostToolUse" as const,
        additionalContext: "async done",
      },
    }),
  defaultDeps: {},
};

// Empty output contract (previously "silent") — Stop events carry no tool_name
const emptyOutput: HookContract<StopInput, {}> = {
  name: "TestEmpty",
  event: "Stop",
  accepts: () => true,
  execute: () => ok({}),
  defaultDeps: {},
};

const validToolInput = JSON.stringify({
  session_id: "test-sess",
  tool_name: "TaskUpdate",
  tool_input: { taskId: "C1", status: "in_progress" },
});

const validStopInput = JSON.stringify({
  session_id: "test-sess",
});

// ─── Pipeline Tests ──────────────────────────────────────────────────────────

describe("runHook — pipeline basics", () => {
  it("produces continue JSON for simple contract", async () => {
    const io = createMockIO();
    await runHook(alwaysContinue, { ...io, stdinOverride: validToolInput });
    expect(io.stdoutLines.length).toBe(1);
    expect(JSON.parse(io.stdoutLines[0])).toEqual({ continue: true });
    expect(io.exitCode).toBe(0);
  });

  it("includes additionalContext inside hookSpecificOutput", async () => {
    const io = createMockIO();
    await runHook(withContext, { ...io, stdinOverride: validToolInput });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(output.hookSpecificOutput.additionalContext).toBe("extra info");
  });

  it("preserves empty string additionalContext (not dropped as falsy)", async () => {
    const io = createMockIO();
    await runHook(withEmptyContext, { ...io, stdinOverride: validToolInput });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(output.hookSpecificOutput.additionalContext).toBe("");
  });

  it("produces PreToolUse block via hookSpecificOutput permissionDecision", async () => {
    const io = createMockIO();
    await runHook(blocker, { ...io, stdinOverride: validToolInput });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toBe("not allowed");
  });

  it("falls back to safe continue on execute error", async () => {
    const io = createMockIO();
    await runHook(failing, { ...io, stdinOverride: validToolInput });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.continue).toBe(true);
    expect(io.stderrLines.some((l) => l.includes("bad data"))).toBe(true);
  });
});

describe("runHook — accepts() gate", () => {
  it("skips execution when accepts returns false", async () => {
    const io = createMockIO();
    const input = JSON.stringify({
      session_id: "s",
      tool_name: "OtherTool",
      tool_input: {},
    });
    await runHook(selective, { ...io, stdinOverride: input });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.continue).toBe(true);
    expect(output.hookSpecificOutput).toBeUndefined();
  });

  it("runs execution when accepts returns true", async () => {
    const io = createMockIO();
    const input = JSON.stringify({
      session_id: "s",
      tool_name: "SpecificTool",
      tool_input: {},
    });
    await runHook(selective, { ...io, stdinOverride: input });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.additionalContext).toBe("accepted");
  });
});

describe("runHook — input handling", () => {
  it("handles empty stdin gracefully", async () => {
    const io = createMockIO();
    await runHook(alwaysContinue, { ...io, stdinOverride: "" });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.continue).toBe(true);
  });

  it("handles invalid JSON gracefully", async () => {
    const io = createMockIO();
    await runHook(alwaysContinue, { ...io, stdinOverride: "not json {{{" });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.continue).toBe(true);
    expect(io.stderrLines.some((l) => l.includes("parse"))).toBe(true);
  });
});

describe("runHook — output types", () => {
  it("async contracts work correctly", async () => {
    const io = createMockIO();
    await runHook(asyncContract, { ...io, stdinOverride: validToolInput });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.additionalContext).toBe("async done");
  });

  it("empty output produces no stdout for Stop contracts", async () => {
    const io = createMockIO();
    await runHook(emptyOutput, { ...io, stdinOverride: validStopInput });
    expect(io.stdoutLines.length).toBe(0);
    expect(io.exitCode).toBe(0);
  });

  it("PostToolUse ok({}) normalizes to { continue: true }", async () => {
    const toolEmptyContract: HookContract<ToolHookInput, {}> = {
      name: "TestToolEmpty",
      event: "PostToolUse",
      accepts: () => true,
      execute: () => ok({}),
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHook(toolEmptyContract, { ...io, stdinOverride: validToolInput });
    expect(io.stdoutLines.length).toBe(1);
    expect(JSON.parse(io.stdoutLines[0])).toEqual({ continue: true });
    expect(io.exitCode).toBe(0);
  });
});

describe("runHook — error safety", () => {
  it("catches thrown exceptions in execute", async () => {
    const throwing: HookContract<ToolHookInput, {}> = {
      name: "TestThrowing",
      event: "PostToolUse",
      accepts: () => true,
      execute: () => {
        throw new Error("boom");
      },
      defaultDeps: {},
    };
    const io = createMockIO();
    await runHook(throwing, { ...io, stdinOverride: validToolInput });
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.continue).toBe(true);
    expect(io.stderrLines.some((l) => l.includes("boom"))).toBe(true);
  });

  it("always exits 0", async () => {
    const io = createMockIO();
    await runHook(failing, { ...io, stdinOverride: validToolInput });
    expect(io.exitCode).toBe(0);
  });
});
