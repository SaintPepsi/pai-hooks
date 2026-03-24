/**
 * CodingStandards Integration Tests — Advisor + Enforcer end-to-end
 *
 * Tests both hooks through the full runHook pipeline using fixture files.
 * Verifies the correct hookSpecificOutput format that Claude Code expects.
 *
 * Run with: RUN_INTEGRATION=1 bun test contracts/CodingStandards.integration.test.ts
 */

import { describe, it, expect } from "bun:test";
import { runHook, type RunHookOptions } from "@hooks/core/runner";
import { CodingStandardsAdvisor } from "@hooks/contracts/CodingStandardsAdvisor";
import { CodingStandardsEnforcer } from "@hooks/contracts/CodingStandardsEnforcer";
import { join } from "path";

// ─── Integration Guard ──────────────────────────────────────────────────────
// Cost/time guard — only run when explicitly requested
// Run with: RUN_INTEGRATION=1 bun test contracts/CodingStandards.integration.test.ts

const defaultDeps = {
  runIntegration: process.env.RUN_INTEGRATION,
};
const INTEGRATION_ENABLED = defaultDeps.runIntegration === "1";
const suite = INTEGRATION_ENABLED ? describe : describe.skip;

// ─── Test Helpers ────────────────────────────────────────────────────────────

const FIXTURES_DIR = join(import.meta.dir, "..", "test-fixtures");
const DIRTY_FILE = join(FIXTURES_DIR, "dirty-file.ts");
const CLEAN_FILE = join(FIXTURES_DIR, "clean-file.ts");

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

function makePostToolUseReadInput(filePath: string): string {
  return JSON.stringify({
    session_id: "test-integration",
    tool_name: "Read",
    tool_input: { file_path: filePath },
    tool_result: { filePath, content: "..." },
  });
}

function makePreToolUseEditInput(filePath: string): string {
  return JSON.stringify({
    session_id: "test-integration",
    tool_name: "Edit",
    tool_input: {
      file_path: filePath,
      old_string: "const CONFIG_PATH",
      new_string: "const CFG_PATH",
    },
  });
}

function makePreToolUseWriteInput(filePath: string, content: string): string {
  return JSON.stringify({
    session_id: "test-integration",
    tool_name: "Write",
    tool_input: {
      file_path: filePath,
      content,
    },
  });
}

// ─── CodingStandardsAdvisor Integration ─────────────────────────────────────

suite("CodingStandardsAdvisor — integration (dirty fixture)", () => {
  it("returns hookSpecificOutput with additionalContext for dirty file", async () => {
    const io = createMockIO();
    await runHook(CodingStandardsAdvisor, {
      ...io,
      stdinOverride: makePostToolUseReadInput(DIRTY_FILE),
    });

    expect(io.exitCode).toBe(0);
    expect(io.stdoutLines.length).toBe(1);

    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput).toBeDefined();
    expect(output.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(output.hookSpecificOutput.additionalContext).toContain("CODING STANDARDS");
    expect(output.hookSpecificOutput.additionalContext).toContain("raw Node builtin imports");
    expect(output.hookSpecificOutput.additionalContext).toContain("try-catch flow control");
    expect(output.hookSpecificOutput.additionalContext).toContain("process.env access");
  });

  it("reports correct violation count for dirty fixture", async () => {
    const io = createMockIO();
    await runHook(CodingStandardsAdvisor, {
      ...io,
      stdinOverride: makePostToolUseReadInput(DIRTY_FILE),
    });

    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.additionalContext).toContain("12 violations");
  });

  it("reports new violation categories in dirty fixture", async () => {
    const io = createMockIO();
    await runHook(CodingStandardsAdvisor, {
      ...io,
      stdinOverride: makePostToolUseReadInput(DIRTY_FILE),
    });

    const output = JSON.parse(io.stdoutLines[0]);
    const ctx = output.hookSpecificOutput.additionalContext;
    expect(ctx).toContain("inline import type");
    expect(ctx).toContain("unsafe type cast");
    expect(ctx).toContain("relative import path");
  });
});

suite("CodingStandardsAdvisor — integration (clean fixture)", () => {
  it("returns plain continue for clean file", async () => {
    const io = createMockIO();
    await runHook(CodingStandardsAdvisor, {
      ...io,
      stdinOverride: makePostToolUseReadInput(CLEAN_FILE),
    });

    expect(io.exitCode).toBe(0);
    const output = JSON.parse(io.stdoutLines[0]);
    expect(output).toEqual({ continue: true });
    expect(output.hookSpecificOutput).toBeUndefined();
  });
});

suite("CodingStandardsAdvisor — integration (non-TS file)", () => {
  it("returns plain continue for non-TypeScript file", async () => {
    const io = createMockIO();
    await runHook(CodingStandardsAdvisor, {
      ...io,
      stdinOverride: makePostToolUseReadInput("/tmp/readme.md"),
    });

    const output = JSON.parse(io.stdoutLines[0]);
    expect(output).toEqual({ continue: true });
  });
});

// ─── CodingStandardsEnforcer Integration ────────────────────────────────────

suite("CodingStandardsEnforcer — integration (dirty fixture)", () => {
  it("returns hookSpecificOutput with permissionDecision deny for Edit on dirty file", async () => {
    const io = createMockIO();
    await runHook(CodingStandardsEnforcer, {
      ...io,
      stdinOverride: makePreToolUseEditInput(DIRTY_FILE),
    });

    expect(io.exitCode).toBe(0);
    expect(io.stdoutLines.length).toBe(1);

    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput).toBeDefined();
    expect(output.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain("violation");
    expect(output.hookSpecificOutput.permissionDecisionReason).toContain("12 violation");
  });

  it("returns hookSpecificOutput with permissionDecision deny for Write of dirty content", async () => {
    const io = createMockIO();
    const dirtyContent = `import { readFileSync } from "fs";\ntry { readFileSync("x"); } catch (e) {}`;
    await runHook(CodingStandardsEnforcer, {
      ...io,
      stdinOverride: makePreToolUseWriteInput("/tmp/test.ts", dirtyContent),
    });

    const output = JSON.parse(io.stdoutLines[0]);
    expect(output.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("shows progressive fix instructions (only relevant categories)", async () => {
    const io = createMockIO();
    const content = "const x = data as any;";
    await runHook(CodingStandardsEnforcer, {
      ...io,
      stdinOverride: makePreToolUseWriteInput("/tmp/test.ts", content),
    });

    const output = JSON.parse(io.stdoutLines[0]);
    const reason = output.hookSpecificOutput.permissionDecisionReason;
    // Should show fix for as-any
    expect(reason).toContain("Use proper types");
    // Should NOT show fixes for categories without violations
    expect(reason).not.toContain("raw Node builtins");
    expect(reason).not.toContain("try-catch");
    expect(reason).not.toContain("environment config");
  });
});

suite("CodingStandardsEnforcer — integration (clean fixture)", () => {
  it("returns plain continue for Edit on clean file", async () => {
    const io = createMockIO();
    const input = JSON.stringify({
      session_id: "test-integration",
      tool_name: "Edit",
      tool_input: {
        file_path: CLEAN_FILE,
        old_string: "formatTimestamp",
        new_string: "formatTime",
      },
    });
    await runHook(CodingStandardsEnforcer, {
      ...io,
      stdinOverride: input,
    });

    const output = JSON.parse(io.stdoutLines[0]);
    expect(output).toEqual({ continue: true });
  });

  it("returns plain continue for Write of clean content", async () => {
    const io = createMockIO();
    const cleanContent = `export function add(a: number, b: number): number {\n  return a + b;\n}`;
    await runHook(CodingStandardsEnforcer, {
      ...io,
      stdinOverride: makePreToolUseWriteInput("/tmp/math.ts", cleanContent),
    });

    const output = JSON.parse(io.stdoutLines[0]);
    expect(output).toEqual({ continue: true });
  });
});

// ─── Adapter Exemption ──────────────────────────────────────────────────────

suite("CodingStandards — adapter exemption", () => {
  it("Advisor skips files in adapters/ directory", async () => {
    const io = createMockIO();
    await runHook(CodingStandardsAdvisor, {
      ...io,
      stdinOverride: makePostToolUseReadInput("/some/project/adapters/fs.ts"),
    });

    const output = JSON.parse(io.stdoutLines[0]);
    expect(output).toEqual({ continue: true });
  });

  it("Enforcer skips files in hooks/core/ directory", async () => {
    const io = createMockIO();
    const dirtyContent = `import { readFileSync } from "fs";\ntry { readFileSync("x"); } catch (e) {}`;
    await runHook(CodingStandardsEnforcer, {
      ...io,
      stdinOverride: makePreToolUseWriteInput("/home/user/.claude/hooks/core/runner.ts", dirtyContent),
    });

    const output = JSON.parse(io.stdoutLines[0]);
    expect(output).toEqual({ continue: true });
  });
});
