/**
 * Tests for lib/signal-logger.ts — Standardised JSONL logging for hook outputs.
 *
 * Injects a fake SignalLoggerDeps with in-memory capture instead of touching
 * the real filesystem or defaultSignalLoggerDeps.
 */

import { describe, expect, it } from "bun:test";
import { err, ok } from "@hooks/core/result";
import { logSignal, type SignalEntry, type SignalLoggerDeps } from "@hooks/lib/signal-logger";

// ─── Fake deps factory ────────────────────────────────────────────────────────

interface Capture {
  ensureDirCalls: string[];
  appendFileCalls: Array<{ path: string; content: string }>;
}

function makeDeps(capture: Capture, baseDir = "/fake/pai"): SignalLoggerDeps {
  return {
    baseDir,
    ensureDir: (path: string) => {
      capture.ensureDirCalls.push(path);
      return ok(undefined);
    },
    appendFile: (path: string, content: string) => {
      capture.appendFileCalls.push({ path, content });
      return ok(undefined);
    },
  };
}

function makeEntry(overrides: Partial<SignalEntry> = {}): SignalEntry {
  return {
    session_id: "sess-abc123",
    hook: "TestHook",
    event: "PostToolUse",
    tool: "Write",
    file: "/some/file.ts",
    outcome: "allow",
    ...overrides,
  };
}

// ─── logSignal ───────────────────────────────────────────────────────────────

describe("logSignal", () => {
  it("calls ensureDir on the SIGNALS directory", () => {
    const capture: Capture = { ensureDirCalls: [], appendFileCalls: [] };
    const deps = makeDeps(capture, "/fake/pai");

    logSignal(deps, "test.jsonl", makeEntry());

    expect(capture.ensureDirCalls).toHaveLength(1);
    expect(capture.ensureDirCalls[0]).toContain("SIGNALS");
    expect(capture.ensureDirCalls[0]).toContain("MEMORY");
  });

  it("writes to the correct log file path", () => {
    const capture: Capture = { ensureDirCalls: [], appendFileCalls: [] };
    const deps = makeDeps(capture, "/fake/pai");

    logSignal(deps, "my-hook.jsonl", makeEntry());

    expect(capture.appendFileCalls).toHaveLength(1);
    expect(capture.appendFileCalls[0].path).toEndWith("my-hook.jsonl");
    expect(capture.appendFileCalls[0].path).toContain("SIGNALS");
  });

  it("uses baseDir to construct the signals path", () => {
    const capture: Capture = { ensureDirCalls: [], appendFileCalls: [] };
    const deps = makeDeps(capture, "/custom/pai-dir");

    logSignal(deps, "hook.jsonl", makeEntry());

    expect(capture.appendFileCalls[0].path).toStartWith("/custom/pai-dir");
  });

  it("writes valid JSON terminated by a newline", () => {
    const capture: Capture = { ensureDirCalls: [], appendFileCalls: [] };
    const deps = makeDeps(capture);

    logSignal(deps, "hook.jsonl", makeEntry());

    const written = capture.appendFileCalls[0].content;
    expect(written).toEndWith("\n");
    // The line before the newline must be valid JSON
    const jsonLine = written.trimEnd();
    expect(() => JSON.parse(jsonLine)).not.toThrow();
  });

  it("injects a timestamp field automatically", () => {
    const capture: Capture = { ensureDirCalls: [], appendFileCalls: [] };
    const deps = makeDeps(capture);

    logSignal(deps, "hook.jsonl", makeEntry());

    const parsed = JSON.parse(capture.appendFileCalls[0].content.trim());
    expect(parsed.timestamp).toBeDefined();
    expect(typeof parsed.timestamp).toBe("string");
    // Should be an ISO 8601 date string
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("preserves all entry fields in the written JSON", () => {
    const capture: Capture = { ensureDirCalls: [], appendFileCalls: [] };
    const deps = makeDeps(capture);

    const entry = makeEntry({
      session_id: "session-xyz",
      hook: "SecurityValidator",
      event: "PreToolUse",
      tool: "Bash",
      file: "/tmp/script.sh",
      outcome: "block",
    });
    logSignal(deps, "security.jsonl", entry);

    const parsed = JSON.parse(capture.appendFileCalls[0].content.trim());
    expect(parsed.session_id).toBe("session-xyz");
    expect(parsed.hook).toBe("SecurityValidator");
    expect(parsed.event).toBe("PreToolUse");
    expect(parsed.tool).toBe("Bash");
    expect(parsed.file).toBe("/tmp/script.sh");
    expect(parsed.outcome).toBe("block");
  });

  it("preserves extra fields beyond the required SignalEntry shape", () => {
    const capture: Capture = { ensureDirCalls: [], appendFileCalls: [] };
    const deps = makeDeps(capture);

    const entry: SignalEntry = {
      ...makeEntry(),
      violations: ["no-raw-process-env"],
      severity: "error",
    } as SignalEntry;

    logSignal(deps, "hook.jsonl", entry);

    const parsed = JSON.parse(capture.appendFileCalls[0].content.trim());
    expect(parsed.violations).toEqual(["no-raw-process-env"]);
    expect(parsed.severity).toBe("error");
  });

  it("timestamp is placed before other entry fields (spread order)", () => {
    const capture: Capture = { ensureDirCalls: [], appendFileCalls: [] };
    const deps = makeDeps(capture);

    logSignal(deps, "hook.jsonl", makeEntry());

    const written = capture.appendFileCalls[0].content.trim();
    // The first key in the JSON object should be "timestamp"
    const firstKey = Object.keys(JSON.parse(written))[0];
    expect(firstKey).toBe("timestamp");
  });

  it("each call appends a separate line", () => {
    const capture: Capture = { ensureDirCalls: [], appendFileCalls: [] };
    const deps = makeDeps(capture);

    logSignal(deps, "hook.jsonl", makeEntry({ outcome: "allow" }));
    logSignal(deps, "hook.jsonl", makeEntry({ outcome: "block" }));

    expect(capture.appendFileCalls).toHaveLength(2);
    const outcomes = capture.appendFileCalls.map(
      (c) => JSON.parse(c.content.trim()).outcome as string,
    );
    expect(outcomes).toContain("allow");
    expect(outcomes).toContain("block");
  });
});
