/**
 * PermissionPromptLogger Contract Tests
 *
 * Tests the diagnostic logging hook: accepts(), execute(),
 * and JSONL append behavior.
 */

import { describe, expect, it } from "bun:test";
import { fileWriteFailed } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import type { PermissionRequestInput } from "@hooks/core/types/hook-inputs";
import {
  PermissionPromptLogger,
  type PermissionPromptLoggerDeps,
} from "@hooks/hooks/SecurityValidator/PermissionPromptLogger/PermissionPromptLogger.contract";

// ─── Mock Deps Factory ───────────────────────────────────────────────────────

function makeDeps(overrides: Partial<PermissionPromptLoggerDeps> = {}): PermissionPromptLoggerDeps {
  return {
    appendFile: (_path: string, _content: string) => ok(undefined),
    ensureDir: (_path: string) => ok(undefined),
    baseDir: "/tmp/test",
    stderr: (_msg: string) => {},
    ...overrides,
  };
}

function makeInput(
  toolName: string,
  toolInput: Record<string, unknown> = {},
): PermissionRequestInput {
  return {
    session_id: "test-session",
    tool_name: toolName,
    tool_input: toolInput,
    permission_mode: "default",
  };
}

// ─── accepts() ───────────────────────────────────────────────────────────────

describe("PermissionPromptLogger.accepts", () => {
  it("accepts all inputs", () => {
    expect(PermissionPromptLogger.accepts(makeInput("Bash"))).toBe(true);
    expect(PermissionPromptLogger.accepts(makeInput("Edit"))).toBe(true);
    expect(PermissionPromptLogger.accepts(makeInput("Write"))).toBe(true);
    expect(PermissionPromptLogger.accepts(makeInput("Agent"))).toBe(true);
  });
});

// ─── execute() ───────────────────────────────────────────────────────────────

describe("PermissionPromptLogger.execute", () => {
  it("returns silent output", () => {
    const deps = makeDeps();
    const result = PermissionPromptLogger.execute(makeInput("Bash", { command: "ls" }), deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });

  it("logs Bash command summary to JSONL", () => {
    let logged = "";
    const deps = makeDeps({
      appendFile: (_path: string, content: string) => {
        logged = content;
        return ok(undefined);
      },
    });

    PermissionPromptLogger.execute(
      makeInput("Bash", { command: "git push --force origin main" }),
      deps,
    );

    const entry = JSON.parse(logged.trim());
    expect(entry.tool_name).toBe("Bash");
    expect(entry.tool_input_summary).toBe("git push --force origin main");
    expect(entry.session_id).toBe("test-session");
    expect(entry.permission_mode).toBe("default");
  });

  it("logs Edit file_path summary", () => {
    let logged = "";
    const deps = makeDeps({
      appendFile: (_path: string, content: string) => {
        logged = content;
        return ok(undefined);
      },
    });

    PermissionPromptLogger.execute(
      makeInput("Edit", { file_path: "/Users/test/.claude/settings.json" }),
      deps,
    );

    const entry = JSON.parse(logged.trim());
    expect(entry.tool_name).toBe("Edit");
    expect(entry.tool_input_summary).toBe("/Users/test/.claude/settings.json");
  });

  it("logs Agent prompt summary", () => {
    let logged = "";
    const deps = makeDeps({
      appendFile: (_path: string, content: string) => {
        logged = content;
        return ok(undefined);
      },
    });

    PermissionPromptLogger.execute(makeInput("Agent", { prompt: "Run tests in background" }), deps);

    const entry = JSON.parse(logged.trim());
    expect(entry.tool_name).toBe("Agent");
    expect(entry.tool_input_summary).toBe("Run tests in background");
  });

  it("truncates long command summaries", () => {
    let logged = "";
    const deps = makeDeps({
      appendFile: (_path: string, content: string) => {
        logged = content;
        return ok(undefined);
      },
    });

    const longCommand = "x".repeat(500);
    PermissionPromptLogger.execute(makeInput("Bash", { command: longCommand }), deps);

    const entry = JSON.parse(logged.trim());
    expect(entry.tool_input_summary.length).toBe(200);
  });

  it("writes to correct log path", () => {
    let writtenPath = "";
    const deps = makeDeps({
      appendFile: (path: string, _content: string) => {
        writtenPath = path;
        return ok(undefined);
      },
    });

    PermissionPromptLogger.execute(makeInput("Bash", { command: "ls" }), deps);

    expect(writtenPath).toBe("/tmp/test/MEMORY/SECURITY/permission-prompts.jsonl");
  });

  it("ensures log directory exists", () => {
    let ensuredDir = "";
    const deps = makeDeps({
      ensureDir: (path: string) => {
        ensuredDir = path;
        return ok(undefined);
      },
    });

    PermissionPromptLogger.execute(makeInput("Bash", { command: "ls" }), deps);

    expect(ensuredDir).toBe("/tmp/test/MEMORY/SECURITY");
  });

  it("handles appendFile failure gracefully", () => {
    const stderrLines: string[] = [];
    const deps = makeDeps({
      appendFile: () => err(fileWriteFailed("permission-prompts.jsonl", "disk full")),
      stderr: (msg: string) => {
        stderrLines.push(msg);
      },
    });

    const result = PermissionPromptLogger.execute(makeInput("Bash", { command: "ls" }), deps);

    expect(result.ok).toBe(true);
    expect(stderrLines.some((line) => line.includes("Failed to write log"))).toBe(true);
  });

  it("includes permission_suggestions in log", () => {
    let logged = "";
    const deps = makeDeps({
      appendFile: (_path: string, content: string) => {
        logged = content;
        return ok(undefined);
      },
    });

    const input: PermissionRequestInput = {
      session_id: "test-session",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      permission_mode: "default",
      permission_suggestions: [
        {
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: "ls" }],
          behavior: "allow",
          destination: "localSettings",
        },
      ],
    };

    PermissionPromptLogger.execute(input, deps);

    const entry = JSON.parse(logged.trim());
    expect(entry.suggestions).toContain("addRules");
  });

  it("handles empty tool_input", () => {
    let logged = "";
    const deps = makeDeps({
      appendFile: (_path: string, content: string) => {
        logged = content;
        return ok(undefined);
      },
    });

    PermissionPromptLogger.execute(makeInput("Unknown", {}), deps);

    const entry = JSON.parse(logged.trim());
    expect(entry.tool_name).toBe("Unknown");
    expect(entry.tool_input_summary).toBe("{}");
  });
});
