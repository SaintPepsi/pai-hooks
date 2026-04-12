import { afterEach, describe, expect, it, type Mock, mock } from "bun:test";
import type { ResultError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import { err, ok } from "@hooks/core/result";
import { handleVoice, type VoiceNotificationDeps } from "@hooks/handlers/VoiceNotification";
import { clearCache } from "@hooks/lib/identity";
import type { ParsedTranscript } from "@pai/Tools/TranscriptParser";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(overrides: Partial<VoiceNotificationDeps> = {}): VoiceNotificationDeps {
  return {
    fileExists: () => false,
    readJson: <T = unknown>(): Result<T, ResultError> =>
      err({
        name: "ResultError",
        code: "FILE_NOT_FOUND",
        message: "not found",
      } as ResultError),
    appendFile: (): Result<void, ResultError> => ok(undefined),
    ensureDir: (): Result<void, ResultError> => ok(undefined),
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
    fetch: mock(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))),
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
    structured: { sections: [] },
    responseState: "complete",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// handleVoice — sends notification to voice server
// ---------------------------------------------------------------------------

type AppendFn = (path: string, content: string) => Result<void, ResultError>;
type StderrFn = (msg: string) => void;

function makeFetchMock(response: Response): Mock<FetchFn> {
  return mock((_url: string, _init?: RequestInit) => Promise.resolve(response));
}

function makeOkFetchMock(): Mock<FetchFn> {
  return makeFetchMock(new Response(JSON.stringify({ ok: true }), { status: 200 }));
}

describe("handleVoice", () => {
  afterEach(() => clearCache());

  it("sends notification to voice server with correct payload", async () => {
    const fetchMock = makeOkFetchMock();
    const deps = makeDeps({ fetch: fetchMock });
    const transcript = makeTranscript();

    await handleVoice(transcript, "test-session-1", deps);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8888/notify");

    const body = JSON.parse((options as RequestInit & { body: string }).body);
    expect(body.message).toBe("Tests are passing and coverage looks solid");
    expect(body.voice_enabled).toBe(true);
    expect(body.voice_id).toBe("kokoro-bf_emma");
  });

  it("includes identity name in notification title", async () => {
    const fetchMock = makeOkFetchMock();
    const deps = makeDeps({ fetch: fetchMock });
    const transcript = makeTranscript();

    await handleVoice(transcript, "test-session-2", deps);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit & { body: string }).body);
    expect(body.title).toBe("TestDA says");
  });

  it("uses fallback when voice completion is invalid", async () => {
    const stderrMock: Mock<StderrFn> = mock((_msg: string) => {});
    const fetchMock = makeOkFetchMock();

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
    const stderrCall = stderrMock.mock.calls[0][0];
    expect(stderrCall).toContain("[Voice] Invalid completion");

    // Should send the fallback message
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit & { body: string }).body);
    expect(body.message).toBe("Fallback completion message for testing");
  });

  it("skips when message is too short after fallback", async () => {
    const fetchMock = makeOkFetchMock();
    const stderrMock: Mock<StderrFn> = mock((_msg: string) => {});

    const deps = makeDeps({
      fetch: fetchMock,
      stderr: stderrMock,
      isValidVoiceCompletion: () => false,
      getVoiceFallback: () => "", // empty fallback
    });

    const transcript = makeTranscript({ voiceCompletion: "tiny" });
    await handleVoice(transcript, "test-session-4", deps);

    // fetch should NOT be called — message too short
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips when voice completion is under 5 characters", async () => {
    const fetchMock = makeOkFetchMock();
    const stderrMock: Mock<StderrFn> = mock((_msg: string) => {});

    const deps = makeDeps({
      fetch: fetchMock,
      stderr: stderrMock,
      isValidVoiceCompletion: () => false,
      getVoiceFallback: () => "Hi", // too short
    });

    const transcript = makeTranscript({ voiceCompletion: "x" });
    await handleVoice(transcript, "test-session-5", deps);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs voice event on successful send", async () => {
    const appendMock: Mock<AppendFn> = mock((_path: string, _content: string) => ok(undefined));
    const fetchMock = makeOkFetchMock();

    const deps = makeDeps({
      fetch: fetchMock,
      appendFile: appendMock,
    });

    await handleVoice(makeTranscript(), "test-session-6", deps);

    // appendFile called for voice-events.jsonl logging
    expect(appendMock).toHaveBeenCalled();
    const logPath = appendMock.mock.calls[0][0];
    expect(logPath).toContain("voice-events.jsonl");
  });

  it("logs failed event when fetch rejects", async () => {
    const appendMock: Mock<AppendFn> = mock((_path: string, _content: string) => ok(undefined));
    const stderrMock: Mock<StderrFn> = mock((_msg: string) => {});
    const fetchMock: Mock<FetchFn> = mock((_url: string, _init?: RequestInit) =>
      Promise.reject(new Error("Connection refused")),
    );

    const deps = makeDeps({
      fetch: fetchMock,
      appendFile: appendMock,
      stderr: stderrMock,
    });

    await handleVoice(makeTranscript(), "test-session-7", deps);

    // stderr should log the failure
    expect(stderrMock).toHaveBeenCalled();
    const stderrMsg = stderrMock.mock.calls[0][0];
    expect(stderrMsg).toContain("[Voice] Failed to send");

    // Should log a failed event
    const loggedLine = appendMock.mock.calls[0][1];
    const parsed = JSON.parse(loggedLine.trim());
    expect(parsed.event_type).toBe("failed");
  });

  it("logs failed event when server returns error status", async () => {
    const appendMock: Mock<AppendFn> = mock((_path: string, _content: string) => ok(undefined));
    const stderrMock: Mock<StderrFn> = mock((_msg: string) => {});
    const fetchMock = makeFetchMock(
      new Response("Internal Server Error", {
        status: 500,
        statusText: "Internal Server Error",
      }),
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
    const logCalls = appendMock.mock.calls.filter((call) => call[0].includes("voice-events.jsonl"));
    expect(logCalls.length).toBeGreaterThan(0);
    const parsed = JSON.parse(logCalls[0][1].trim());
    expect(parsed.event_type).toBe("failed");
    expect(parsed.status_code).toBe(500);
  });

  it("writes to session work dir when active work state exists", async () => {
    const appendMock: Mock<AppendFn> = mock((_path: string, _content: string) => ok(undefined));
    const fetchMock = makeOkFetchMock();

    const deps = makeDeps({
      fetch: fetchMock,
      appendFile: appendMock,
      fileExists: (path: string) => path.includes("WORK/my-session-dir"),
      readJson: <T = unknown>(): Result<T, ResultError> =>
        ok({
          session_id: "test-session-9",
          session_dir: "my-session-dir",
        } as unknown as T),
    });

    await handleVoice(makeTranscript(), "test-session-9", deps);

    // Should write to both global and session voice.jsonl
    const logPaths = appendMock.mock.calls.map((call) => call[0]);
    const hasGlobal = logPaths.some((p) => p.includes("voice-events.jsonl"));
    const hasSession = logPaths.some(
      (p) => p.includes("voice.jsonl") && p.includes("my-session-dir"),
    );
    expect(hasGlobal).toBe(true);
    expect(hasSession).toBe(true);
  });
});
