/**
 * WikiReadTracker Contract Tests
 *
 * Tests the accepts() gate and execute() method for wiki read metric tracking.
 */

import { describe, expect, it } from "bun:test";
import { ErrorCode, ResultError } from "@hooks/core/error";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { makeToolInput } from "@hooks/lib/test-helpers";
import { WikiReadTracker, type WikiReadTrackerDeps } from "./WikiReadTracker.contract";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<WikiReadTrackerDeps> = {}): WikiReadTrackerDeps {
  return {
    appendFile: () => ({ ok: true, value: undefined }),
    wikiDir: "/tmp/test-wiki",
    stderr: () => {},
    ...overrides,
  };
}

function makeReadInput(filePath: string, sessionId = "test-sess"): ToolHookInput {
  return {
    session_id: sessionId,
    tool_name: "Read",
    tool_input: { file_path: filePath },
  };
}

// ─── accepts() gate ─────────────────────────────────────────────────────────

describe("WikiReadTracker.accepts()", () => {
  it("accepts Read of MEMORY/WIKI/ paths", () => {
    const input = makeReadInput("/Users/hogers/.claude/MEMORY/WIKI/entities/koord.md");
    expect(WikiReadTracker.accepts(input)).toBe(true);
  });

  it("accepts Read of nested MEMORY/WIKI/ paths", () => {
    const input = makeReadInput("/Users/hogers/.claude/MEMORY/WIKI/.pipeline/metrics.jsonl");
    expect(WikiReadTracker.accepts(input)).toBe(true);
  });

  it("rejects Read of non-wiki paths", () => {
    const input = makeReadInput("/Users/hogers/.claude/MEMORY/LEARNING/signals.jsonl");
    expect(WikiReadTracker.accepts(input)).toBe(false);
  });

  it("rejects Read with no file_path", () => {
    const input: ToolHookInput = {
      session_id: "test-sess",
      tool_name: "Read",
      tool_input: {},
    };
    expect(WikiReadTracker.accepts(input)).toBe(false);
  });

  it("rejects Write to MEMORY/WIKI/ paths", () => {
    const input = makeToolInput("Write", "/Users/hogers/.claude/MEMORY/WIKI/entities/koord.md");
    expect(WikiReadTracker.accepts(input)).toBe(false);
  });

  it("rejects Edit to MEMORY/WIKI/ paths", () => {
    const input = makeToolInput("Edit", "/Users/hogers/.claude/MEMORY/WIKI/entities/koord.md");
    expect(WikiReadTracker.accepts(input)).toBe(false);
  });

  it("rejects Bash tool", () => {
    const input = makeToolInput("Bash", "/Users/hogers/.claude/MEMORY/WIKI/entities/koord.md");
    expect(WikiReadTracker.accepts(input)).toBe(false);
  });

  it("rejects Glob tool", () => {
    const input = makeToolInput("Glob", "/Users/hogers/.claude/MEMORY/WIKI/entities/koord.md");
    expect(WikiReadTracker.accepts(input)).toBe(false);
  });
});

// ─── execute() ──────────────────────────────────────────────────────────────

describe("WikiReadTracker.execute()", () => {
  it("appends metric record with correct fields", () => {
    let appendedPath = "";
    let appendedContent = "";

    const deps = makeDeps({
      appendFile: (path: string, content: string) => {
        appendedPath = path;
        appendedContent = content;
        return { ok: true, value: undefined };
      },
    });

    const input = makeReadInput(
      "/Users/hogers/.claude/MEMORY/WIKI/entities/koord.md",
      "session-abc-123",
    );
    const result = WikiReadTracker.execute(input, deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.continue).toBe(true);
      expect(result.value.hookSpecificOutput).toBeUndefined();
    }

    expect(appendedPath).toBe("/tmp/test-wiki/.pipeline/metrics.jsonl");

    const record = JSON.parse(appendedContent.trimEnd());
    expect(record.session_id).toBe("session-abc-123");
    expect(record.path).toBe("/Users/hogers/.claude/MEMORY/WIKI/entities/koord.md");
    expect(record.timestamp).toBeDefined();
    // Verify timestamp is valid ISO 8601
    expect(new Date(record.timestamp).toISOString()).toBe(record.timestamp);
  });

  it("appends newline-terminated JSON", () => {
    let appendedContent = "";

    const deps = makeDeps({
      appendFile: (_path: string, content: string) => {
        appendedContent = content;
        return { ok: true, value: undefined };
      },
    });

    const input = makeReadInput("/Users/hogers/.claude/MEMORY/WIKI/entities/test.md");
    WikiReadTracker.execute(input, deps);

    expect(appendedContent.endsWith("\n")).toBe(true);
  });

  it("returns continueOk even when appendFile fails", () => {
    const deps = makeDeps({
      appendFile: () => ({
        ok: false as const,
        error: new ResultError(ErrorCode.FileWriteFailed, "disk full"),
      }),
    });

    const input = makeReadInput("/Users/hogers/.claude/MEMORY/WIKI/entities/koord.md");
    const result = WikiReadTracker.execute(input, deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.continue).toBe(true);
    }
  });

  it("logs error to stderr when appendFile fails", () => {
    const stderrMessages: string[] = [];

    const deps = makeDeps({
      appendFile: () => ({
        ok: false as const,
        error: new ResultError(ErrorCode.FileWriteFailed, "disk full"),
      }),
      stderr: (msg: string) => stderrMessages.push(msg),
    });

    const input = makeReadInput("/Users/hogers/.claude/MEMORY/WIKI/entities/koord.md");
    WikiReadTracker.execute(input, deps);

    expect(stderrMessages.length).toBeGreaterThan(0);
    expect(stderrMessages[0]).toContain("WikiReadTracker");
  });

  it("returns continueOk when session_id is missing", () => {
    const deps = makeDeps();
    const input: ToolHookInput = {
      session_id: "",
      tool_name: "Read",
      tool_input: { file_path: "/Users/hogers/.claude/MEMORY/WIKI/entities/koord.md" },
    };
    const result = WikiReadTracker.execute(input, deps);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.continue).toBe(true);
    }
  });
});
