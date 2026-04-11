/**
 * LastResponseCache Contract Tests
 *
 * Covers: name/event identity, accepts() gate, execute() with all transcript
 * parsing branches (empty, malformed JSON, string content, ContentBlock[] content,
 * no assistant messages, successful cache write, failed cache write).
 * Target: 100% branch + 100% line coverage.
 */

import { describe, expect, it } from "bun:test";
import { fileReadFailed, fileWriteFailed } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import type { StopInput } from "@hooks/core/types/hook-inputs";
import {
  LastResponseCache,
  type LastResponseCacheDeps,
} from "@hooks/hooks/LastResponseCache/LastResponseCache/LastResponseCache.contract";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInput(transcriptPath?: string): StopInput {
  return {
    session_id: "test-sess",
    transcript_path: transcriptPath,
  };
}

function makeDeps(overrides: Partial<LastResponseCacheDeps> = {}): LastResponseCacheDeps {
  return {
    readFile: () => ok(""),
    writeFile: () => ok(undefined),
    stderr: () => {},
    baseDir: "/tmp/test",
    ...overrides,
  };
}

// ─── Identity ─────────────────────────────────────────────────────────────────

describe("LastResponseCache", () => {
  it("has correct name", () => {
    expect(LastResponseCache.name).toBe("LastResponseCache");
  });

  it("has correct event", () => {
    expect(LastResponseCache.event).toBe("Stop");
  });
});

// ─── accepts() ────────────────────────────────────────────────────────────────

describe("LastResponseCache.accepts()", () => {
  it("accepts when transcript_path is present", () => {
    expect(LastResponseCache.accepts(makeInput("/tmp/transcript.jsonl"))).toBe(true);
  });

  it("rejects when transcript_path is undefined", () => {
    expect(LastResponseCache.accepts(makeInput(undefined))).toBe(false);
  });

  it("rejects when transcript_path is empty string", () => {
    expect(LastResponseCache.accepts(makeInput(""))).toBe(false);
  });
});

// ─── execute() — transcript read failure ──────────────────────────────────────

describe("LastResponseCache.execute() — transcript read failure", () => {
  it("returns silent and logs when transcript cannot be read", () => {
    const messages: string[] = [];
    const deps = makeDeps({
      readFile: () => err(fileReadFailed("/tmp/transcript.jsonl", new Error("not found"))),
      stderr: (msg) => messages.push(msg),
    });
    const result = LastResponseCache.execute(makeInput("/tmp/transcript.jsonl"), deps);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
    expect(messages.some((m) => m.includes("Could not read transcript"))).toBe(true);
    // Also logs "No assistant message"
    expect(messages.some((m) => m.includes("No assistant message"))).toBe(true);
  });
});

// ─── execute() — empty/malformed transcript ───────────────────────────────────

describe("LastResponseCache.execute() — empty and malformed transcripts", () => {
  it("returns silent when transcript is empty", () => {
    const messages: string[] = [];
    const deps = makeDeps({
      readFile: () => ok(""),
      stderr: (msg) => messages.push(msg),
    });
    const result = LastResponseCache.execute(makeInput("/tmp/t.jsonl"), deps);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
    expect(messages.some((m) => m.includes("No assistant message"))).toBe(true);
  });

  it("returns silent when transcript contains only blank lines", () => {
    const messages: string[] = [];
    const deps = makeDeps({
      readFile: () => ok("\n\n  \n"),
      stderr: (msg) => messages.push(msg),
    });
    const result = LastResponseCache.execute(makeInput("/tmp/t.jsonl"), deps);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
    expect(messages.some((m) => m.includes("No assistant message"))).toBe(true);
  });

  it("skips malformed JSON lines and continues", () => {
    const messages: string[] = [];
    const transcript = [
      "not valid json",
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: "Hello" } }),
    ].join("\n");
    const deps = makeDeps({
      readFile: () => ok(transcript),
      stderr: (msg) => messages.push(msg),
    });
    const result = LastResponseCache.execute(makeInput("/tmp/t.jsonl"), deps);

    expect(result.ok).toBe(true);
    // Should have written the cache (found an assistant message)
    expect(messages.every((m) => !m.includes("No assistant message"))).toBe(true);
  });
});

// ─── execute() — no assistant messages ────────────────────────────────────────

describe("LastResponseCache.execute() — no assistant messages", () => {
  it("returns silent when transcript has only user messages", () => {
    const messages: string[] = [];
    const transcript = JSON.stringify({ type: "user", message: { role: "user", content: "Hi" } });
    const deps = makeDeps({
      readFile: () => ok(transcript),
      stderr: (msg) => messages.push(msg),
    });
    const result = LastResponseCache.execute(makeInput("/tmp/t.jsonl"), deps);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
    expect(messages.some((m) => m.includes("No assistant message"))).toBe(true);
  });

  it("returns silent when assistant message has empty content", () => {
    const messages: string[] = [];
    const transcript = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: "   " },
    });
    const deps = makeDeps({
      readFile: () => ok(transcript),
      stderr: (msg) => messages.push(msg),
    });
    const result = LastResponseCache.execute(makeInput("/tmp/t.jsonl"), deps);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
    expect(messages.some((m) => m.includes("No assistant message"))).toBe(true);
  });

  it("returns silent when assistant message has no content field", () => {
    const messages: string[] = [];
    const transcript = JSON.stringify({
      type: "assistant",
      message: { role: "assistant" },
    });
    const deps = makeDeps({
      readFile: () => ok(transcript),
      stderr: (msg) => messages.push(msg),
    });
    const result = LastResponseCache.execute(makeInput("/tmp/t.jsonl"), deps);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
    expect(messages.some((m) => m.includes("No assistant message"))).toBe(true);
  });
});

// ─── execute() — content types ────────────────────────────────────────────────

describe("LastResponseCache.execute() — content types", () => {
  it("extracts text from string content", () => {
    let writtenContent = "";
    const transcript = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: "Hello world" },
    });
    const deps = makeDeps({
      readFile: () => ok(transcript),
      writeFile: (_path, content) => {
        writtenContent = content;
        return ok(undefined);
      },
    });

    LastResponseCache.execute(makeInput("/tmp/t.jsonl"), deps);
    expect(writtenContent).toBe("Hello world");
  });

  it("extracts text from ContentBlock[] content", () => {
    let writtenContent = "";
    const transcript = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Part one" },
          { type: "image", data: "..." },
          { type: "text", text: "Part two" },
        ],
      },
    });
    const deps = makeDeps({
      readFile: () => ok(transcript),
      writeFile: (_path, content) => {
        writtenContent = content;
        return ok(undefined);
      },
    });

    LastResponseCache.execute(makeInput("/tmp/t.jsonl"), deps);
    expect(writtenContent).toBe("Part one Part two");
  });

  it("handles ContentBlock with missing text field", () => {
    let _writtenContent = "";
    const transcript = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text" }],
      },
    });
    const deps = makeDeps({
      readFile: () => ok(transcript),
      writeFile: (_path, content) => {
        _writtenContent = content;
        return ok(undefined);
      },
    });

    // text is undefined so c.text ?? "" yields "", which is empty after trim
    // so lastAssistant stays "" and we get "No assistant message"
    const messages: string[] = [];
    const depsWithStderr = { ...deps, stderr: (msg: string) => messages.push(msg) };
    LastResponseCache.execute(makeInput("/tmp/t.jsonl"), depsWithStderr);
    expect(messages.some((m) => m.includes("No assistant message"))).toBe(true);
  });

  it("uses the last assistant message when multiple exist", () => {
    let writtenContent = "";
    const transcript = [
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: "First" } }),
      JSON.stringify({ type: "user", message: { role: "user", content: "Ok" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: "Second" } }),
    ].join("\n");
    const deps = makeDeps({
      readFile: () => ok(transcript),
      writeFile: (_path, content) => {
        writtenContent = content;
        return ok(undefined);
      },
    });

    LastResponseCache.execute(makeInput("/tmp/t.jsonl"), deps);
    expect(writtenContent).toBe("Second");
  });
});

// ─── execute() — truncation ──────────────────────────────────────────────────

describe("LastResponseCache.execute() — truncation", () => {
  it("truncates response to 2000 chars", () => {
    let writtenContent = "";
    const longText = "A".repeat(3000);
    const transcript = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: longText },
    });
    const deps = makeDeps({
      readFile: () => ok(transcript),
      writeFile: (_path, content) => {
        writtenContent = content;
        return ok(undefined);
      },
    });

    LastResponseCache.execute(makeInput("/tmp/t.jsonl"), deps);
    expect(writtenContent.length).toBe(2000);
  });
});

// ─── execute() — write failure ────────────────────────────────────────────────

describe("LastResponseCache.execute() — write failure", () => {
  it("returns silent and logs when write fails", () => {
    const messages: string[] = [];
    const transcript = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: "Hello" },
    });
    const deps = makeDeps({
      readFile: () => ok(transcript),
      writeFile: () => err(fileWriteFailed("/tmp/cache.txt", new Error("disk full"))),
      stderr: (msg) => messages.push(msg),
    });
    const result = LastResponseCache.execute(makeInput("/tmp/t.jsonl"), deps);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
    expect(messages.some((m) => m.includes("Failed to write cache"))).toBe(true);
  });
});

// ─── execute() — write path ──────────────────────────────────────────────────

describe("LastResponseCache.execute() — cache path", () => {
  it("writes to MEMORY/STATE/last-response.txt under baseDir", () => {
    let writtenPath = "";
    const transcript = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: "Hello" },
    });
    const deps = makeDeps({
      baseDir: "/custom/base",
      readFile: () => ok(transcript),
      writeFile: (path, _content) => {
        writtenPath = path;
        return ok(undefined);
      },
    });

    LastResponseCache.execute(makeInput("/tmp/t.jsonl"), deps);
    expect(writtenPath).toBe("/custom/base/MEMORY/STATE/last-response.txt");
  });
});
