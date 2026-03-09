import { describe, it, expect } from "bun:test";
import { runHook, type RunHookOptions } from "./runner";
import type { HookContract } from "./contract";
import type { ToolHookInput } from "./types/hook-inputs";
import type { ContinueOutput, BlockOutput, ContextOutput, SilentOutput } from "./types/hook-outputs";
import { ok, err } from "./result";
import { invalidInput, type PaiError } from "./error";

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
    stdout: (msg: string) => { io.stdoutLines.push(msg); },
    stderr: (msg: string) => { io.stderrLines.push(msg); },
    exit: (code: number) => { io.exitCode = code; },
    get stdoutLines() { return io.stdoutLines; },
    get stderrLines() { return io.stderrLines; },
    get exitCode() { return io.exitCode; },
  };
}

// Simple contract that always continues
const alwaysContinue: HookContract<ToolHookInput, ContinueOutput, {}> = {
  name: "TestContinue",
  event: "PostToolUse",
  accepts: () => true,
  execute: () => ok({ type: "continue", continue: true as const }),
  defaultDeps: {},
};

// Contract that adds context
const withContext: HookContract<ToolHookInput, ContinueOutput, {}> = {
  name: "TestContext",
  event: "PostToolUse",
  accepts: (input) => input.tool_name === "TaskUpdate",
  execute: () => ok({ type: "continue", continue: true as const, additionalContext: "extra info" }),
  defaultDeps: {},
};

// Contract that returns empty-string context (regression: must not be dropped)
const withEmptyContext: HookContract<ToolHookInput, ContinueOutput, {}> = {
  name: "TestEmptyContext",
  event: "PostToolUse",
  accepts: () => true,
  execute: () => ok({ type: "continue", continue: true as const, additionalContext: "" }),
  defaultDeps: {},
};

// Contract that blocks
const blocker: HookContract<ToolHookInput, BlockOutput, {}> = {
  name: "TestBlocker",
  event: "PreToolUse",
  accepts: () => true,
  execute: () => ok({ type: "block", decision: "block" as const, reason: "not allowed" }),
  defaultDeps: {},
};

// Contract that returns error
const failing: HookContract<ToolHookInput, ContinueOutput, {}> = {
  name: "TestFailing",
  event: "PostToolUse",
  accepts: () => true,
  execute: () => err(invalidInput("bad data")),
  defaultDeps: {},
};

// Contract that rejects via accepts()
const selective: HookContract<ToolHookInput, ContinueOutput, {}> = {
  name: "TestSelective",
  event: "PostToolUse",
  accepts: (input) => input.tool_name === "SpecificTool",
  execute: () => ok({ type: "continue", continue: true as const, additionalContext: "accepted" }),
  defaultDeps: {},
};

// Async contract
const asyncContract: HookContract<ToolHookInput, ContinueOutput, {}> = {
  name: "TestAsync",
  event: "PostToolUse",
  accepts: () => true,
  execute: async () => ok({ type: "continue", continue: true as const, additionalContext: "async done" }),
  defaultDeps: {},
};

// Context output contract (raw string, not JSON)
const contextOutput: HookContract<ToolHookInput, ContextOutput, {}> = {
  name: "TestContextOutput",
  event: "SessionStart",
  accepts: () => true,
  execute: () => ok({ type: "context", content: "Hello from hook" }),
  defaultDeps: {},
};

// Silent output contract
const silentOutput: HookContract<ToolHookInput, SilentOutput, {}> = {
  name: "TestSilent",
  event: "Stop",
  accepts: () => true,
  execute: () => ok({ type: "silent" }),
  defaultDeps: {},
};

const validToolInput = JSON.stringify({
  session_id: "test-sess",
  tool_name: "TaskUpdate",
  tool_input: { taskId: "C1", status: "in_progress" },
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
    expect(output.additionalContext).toBeUndefined();
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
    // Empty string will fail JSON parse, should fall back to safe continue
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

  it("context output produces raw string (not JSON)", async () => {
    const io = createMockIO();
    await runHook(contextOutput, { ...io, stdinOverride: validToolInput });
    expect(io.stdoutLines[0]).toBe("Hello from hook");
  });

  it("silent output produces no stdout", async () => {
    const io = createMockIO();
    await runHook(silentOutput, { ...io, stdinOverride: validToolInput });
    expect(io.stdoutLines.length).toBe(0);
    expect(io.exitCode).toBe(0);
  });
});

describe("runHook — error safety", () => {
  it("catches thrown exceptions in execute", async () => {
    const throwing: HookContract<ToolHookInput, ContinueOutput, {}> = {
      name: "TestThrowing",
      event: "PostToolUse",
      accepts: () => true,
      execute: () => { throw new Error("boom"); },
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
