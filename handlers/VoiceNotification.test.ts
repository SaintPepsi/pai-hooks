import { describe, it, expect, mock } from "bun:test";
import { handleVoice, type VoiceNotificationDeps } from "@hooks/handlers/VoiceNotification";
import { ok, err } from "@hooks/core/result";
import type { Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";
import type { ParsedTranscript } from "@pai/Tools/TranscriptParser";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<VoiceNotificationDeps> = {}): VoiceNotificationDeps {
  return {
    fileExists: () => false,
    readJson: <T = unknown>(): Result<T, PaiError> => err({ name: "PaiError", code: "FILE_NOT_FOUND", message: "not found" } as PaiError),
    appendFile: (): Result<void, PaiError> => ok(undefined),
    ensureDir: (): Result<void, PaiError> => ok(undefined),
    getIdentity: () => ({
      name: "TestDA",
      fullName: "Test Digital Assistant",
      displayName: "TestDA",
      mainDAVoiceID: "kokoro-bf_emma",
      color: "#3B82F6",
    }),
    getTimestamp: () => "2026-03-09T12:00:00.000Z",
    isValidVoiceCompletion: (text: string) => text.length >= 10,
    getVoiceFallback: () => "",
    fetch: mock(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    ),
    baseDir: "/tmp/test-pai",
    stderr: mock(() => {}),
    ...overrides,
  };
}

function makeTranscript(overrides: Partial<ParsedTranscript> = {}): ParsedTranscript {
  return {
    raw: "raw transcript content",
    lastMessage: "Last assistant message here",
    currentResponseText: "Full response text from assistant",
    voiceCompletion: "Tests are passing and coverage looks solid",
    plainCompletion: "Tests passing.",
    structured: {},
    responseState: "completed",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// handleVoice — sends notification to voice server
// ---------------------------------------------------------------------------

describe("handleVoice", () => {
  it("sends notification to voice server with correct payload", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const deps = makeDeps({ fetch: fetchMock });
    const transcript = makeTranscript();

    await handleVoice(transcript, "test-session-1", deps);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8888/notify");

    const body = JSON.parse(options.body);
    expect(body.message).toBe("Tests are passing and coverage looks solid");
    expect(body.voice_enabled).toBe(true);
    expect(body.voice_id).toBe("kokoro-bf_emma");
  });

  it("includes identity name in notification title", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const deps = makeDeps({ fetch: fetchMock });
    const transcript = makeTranscript();

    await handleVoice(transcript, "test-session-2", deps);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.title).toBe("TestDA says");
  });

  it("uses fallback when voice completion is invalid", async () => {
    const stderrMock = mock(() => {});
    const fetchMock = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );

    const deps = makeDeps({
      fetch: fetchMock,
      stderr: stderrMock,
      isValidVoiceCompletion: () => false,
      getVoiceFallback: () => "Fallback completion message for testing",
    });

    const transcript = makeTranscript({ voiceCompletion: "bad" });
    await handleVoice(transcript, "test-session-3", deps);

    // Should log the invalid completion
    expect(stderrMock).toHaveBeenCalled();
    const stderrCall = (stderrMock.mock.calls[0][0]) as string;
    expect(stderrCall).toContain("[Voice] Invalid completion");

    // Should send the fallback message
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.message).toBe("Fallback completion message for testing");
  });

  it("skips when message is too short after fallback", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const stderrMock = mock(() => {});

    const deps = makeDeps({
      fetch: fetchMock,
      stderr: stderrMock,
      isValidVoiceCompletion: () => false,
      getVoiceFallback: () => "",  // empty fallback
    });

    const transcript = makeTranscript({ voiceCompletion: "tiny" });
    await handleVoice(transcript, "test-session-4", deps);

    // fetch should NOT be called — message too short
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips when voice completion is under 5 characters", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    const stderrMock = mock(() => {});

    const deps = makeDeps({
      fetch: fetchMock,
      stderr: stderrMock,
      isValidVoiceCompletion: () => false,
      getVoiceFallback: () => "Hi",  // too short
    });

    const transcript = makeTranscript({ voiceCompletion: "x" });
    await handleVoice(transcript, "test-session-5", deps);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs voice event on successful send", async () => {
    const appendMock = mock((): Result<void, PaiError> => ok(undefined));
    const fetchMock = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );

    const deps = makeDeps({
      fetch: fetchMock,
      appendFile: appendMock,
    });

    await handleVoice(makeTranscript(), "test-session-6", deps);

    // appendFile called for voice-events.jsonl logging
    expect(appendMock).toHaveBeenCalled();
    const logPath = appendMock.mock.calls[0][0] as string;
    expect(logPath).toContain("voice-events.jsonl");
  });

  it("logs failed event when fetch rejects", async () => {
    const appendMock = mock((): Result<void, PaiError> => ok(undefined));
    const stderrMock = mock(() => {});
    const fetchMock = mock(() => Promise.reject(new Error("Connection refused")));

    const deps = makeDeps({
      fetch: fetchMock,
      appendFile: appendMock,
      stderr: stderrMock,
    });

    await handleVoice(makeTranscript(), "test-session-7", deps);

    // stderr should log the failure
    expect(stderrMock).toHaveBeenCalled();
    const stderrMsg = stderrMock.mock.calls[0][0] as string;
    expect(stderrMsg).toContain("[Voice] Failed to send");

    // Should log a failed event
    const loggedLine = appendMock.mock.calls[0][1] as string;
    const parsed = JSON.parse(loggedLine.trim());
    expect(parsed.event_type).toBe("failed");
  });

  it("logs failed event when server returns error status", async () => {
    const appendMock = mock((): Result<void, PaiError> => ok(undefined));
    const stderrMock = mock(() => {});
    const fetchMock = mock(() =>
      Promise.resolve(new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" })),
    );

    const deps = makeDeps({
      fetch: fetchMock,
      appendFile: appendMock,
      stderr: stderrMock,
    });

    await handleVoice(makeTranscript(), "test-session-8", deps);

    // stderr should log the server error
    expect(stderrMock).toHaveBeenCalled();

    // Should log failed event with status code
    const logCalls = appendMock.mock.calls.filter(
      (call) => (call[0] as string).includes("voice-events.jsonl"),
    );
    expect(logCalls.length).toBeGreaterThan(0);
    const parsed = JSON.parse((logCalls[0][1] as string).trim());
    expect(parsed.event_type).toBe("failed");
    expect(parsed.status_code).toBe(500);
  });

  it("writes to session work dir when active work state exists", async () => {
    const appendMock = mock((): Result<void, PaiError> => ok(undefined));
    const fetchMock = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );

    const deps = makeDeps({
      fetch: fetchMock,
      appendFile: appendMock,
      fileExists: (path: string) => path.includes("WORK/my-session-dir"),
      readJson: <T = unknown>(): Result<T, PaiError> =>
        ok({ session_id: "test-session-9", session_dir: "my-session-dir" } as unknown as T),
    });

    await handleVoice(makeTranscript(), "test-session-9", deps);

    // Should write to both global and session voice.jsonl
    const logPaths = appendMock.mock.calls.map((call) => call[0] as string);
    const hasGlobal = logPaths.some((p) => p.includes("voice-events.jsonl"));
    const hasSession = logPaths.some((p) => p.includes("voice.jsonl") && p.includes("my-session-dir"));
    expect(hasGlobal).toBe(true);
    expect(hasSession).toBe(true);
  });
});
