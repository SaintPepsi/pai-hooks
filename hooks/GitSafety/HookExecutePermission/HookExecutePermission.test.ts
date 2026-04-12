/**
 * HookExecutePermission Contract Tests
 *
 * Covers: name/event identity, accepts() gate (tool_name + path filtering),
 * execute() chmod success/failure branches.
 * Target: 100% branch + 100% line coverage.
 */

import { describe, expect, it } from "bun:test";
import { processExecFailed } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  HookExecutePermission,
  type HookExecutePermissionDeps,
} from "./HookExecutePermission.contract";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInput(toolName: string, filePath: string = ""): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: toolName,
    tool_input: { file_path: filePath },
  };
}

function makeDeps(overrides: Partial<HookExecutePermissionDeps> = {}): HookExecutePermissionDeps {
  return {
    execSync: () => ok(""),
    stderr: () => {},
    ...overrides,
  };
}

// ─── Identity ─────────────────────────────────────────────────────────────────

describe("HookExecutePermission", () => {
  it("has correct name", () => {
    expect(HookExecutePermission.name).toBe("HookExecutePermission");
  });

  it("has correct event", () => {
    expect(HookExecutePermission.event).toBe("PostToolUse");
  });
});

// ─── accepts() ────────────────────────────────────────────────────────────────

describe("HookExecutePermission.accepts()", () => {
  it("accepts Write to a .hook.ts inside /hooks/", () => {
    const input = makeInput("Write", "/home/user/.claude/hooks/my.hook.ts");
    expect(HookExecutePermission.accepts(input)).toBe(true);
  });

  it("rejects non-Write tool", () => {
    const input = makeInput("Edit", "/home/user/.claude/hooks/my.hook.ts");
    expect(HookExecutePermission.accepts(input)).toBe(false);
  });

  it("rejects Write to a file not ending in .hook.ts", () => {
    const input = makeInput("Write", "/home/user/.claude/hooks/utils.ts");
    expect(HookExecutePermission.accepts(input)).toBe(false);
  });

  it("rejects Write to a .hook.ts not inside /hooks/ directory", () => {
    const input = makeInput("Write", "/home/user/src/my.hook.ts");
    expect(HookExecutePermission.accepts(input)).toBe(false);
  });

  it("rejects when tool_input has no file_path", () => {
    const input: ToolHookInput = {
      session_id: "test-sess",
      tool_name: "Write",
      tool_input: {},
    };
    expect(HookExecutePermission.accepts(input)).toBe(false);
  });

  it("rejects empty file_path", () => {
    const input = makeInput("Write", "");
    expect(HookExecutePermission.accepts(input)).toBe(false);
  });
});

// ─── execute() ────────────────────────────────────────────────────────────────

describe("HookExecutePermission.execute()", () => {
  it("returns continue after successful chmod", () => {
    const messages: string[] = [];
    const deps = makeDeps({
      execSync: () => ok(""),
      stderr: (msg) => messages.push(msg),
    });
    const input = makeInput("Write", "/home/user/.claude/hooks/my.hook.ts");
    const result = HookExecutePermission.execute(input, deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.continue).toBe(true);
    }
    expect(messages.length).toBe(1);
    expect(messages[0]).toContain("Set +x on");
  });

  it("returns continue even when chmod fails, and logs error", () => {
    const messages: string[] = [];
    const deps = makeDeps({
      execSync: () => err(processExecFailed("chmod", new Error("permission denied"))),
      stderr: (msg) => messages.push(msg),
    });
    const input = makeInput("Write", "/home/user/.claude/hooks/my.hook.ts");
    const result = HookExecutePermission.execute(input, deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.continue).toBe(true);
    }
    expect(messages.length).toBe(1);
    expect(messages[0]).toContain("chmod failed");
  });
});
