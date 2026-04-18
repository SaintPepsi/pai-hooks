import { describe, expect, it, mock } from "bun:test";
import { ErrorCode, ResultError } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import type { UserPromptSubmitInput } from "@hooks/core/types/hook-inputs";
import type { RatingCaptureDeps } from "./RatingCapture.contract";
import { parseExplicitRating, RatingCapture } from "./RatingCapture.contract";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeInput(
  prompt: string,
  overrides: Partial<UserPromptSubmitInput> = {},
): UserPromptSubmitInput {
  return {
    session_id: "test-session",
    prompt,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<RatingCaptureDeps> = {}): RatingCaptureDeps {
  return {
    inference: mock(async () => ({
      success: true,
      output: "",
      parsed: {
        rating: 7,
        sentiment: "positive",
        confidence: 0.8,
        summary: "good",
        detailed_context: "details",
      },
      latencyMs: 0,
      level: "fast" as const,
    })),
    captureFailure: mock(async () => null),
    getPrincipalName: mock(() => "TestUser"),
    getPrincipal: mock(() => ({
      name: "TestUser",
      pronunciation: "",
      timezone: "UTC",
    })),
    getIdentity: mock(() => ({
      name: "TestBot",
      fullName: "TestBot",
      displayName: "TestBot",
      mainDAVoiceID: "",
      color: "#000000",
    })),
    getLearningCategory: mock((_content: string, _comment?: string) => "SYSTEM" as const),
    getISOTimestamp: mock(() => "2026-02-27T10:00:00Z"),
    getLocalComponents: mock(() => ({
      year: 2026,
      month: "02",
      day: "27",
      hours: "10",
      minutes: "00",
      seconds: "00",
    })),
    fileExists: mock(() => false),
    readFile: mock(() => err(new ResultError(ErrorCode.FileNotFound, "not found"))),
    writeFile: mock(() => ok(undefined)),
    appendFile: mock(() => ok(undefined)),
    ensureDir: mock(() => ok(undefined)),
    spawnTrending: mock(() => {}),
    baseDir: "/tmp/test",
    stderr: mock(() => {}),
    ...overrides,
  };
}

// ─── parseExplicitRating ─────────────────────────────────────────────────────

describe("parseExplicitRating", () => {
  it("parses bare number rating", () => {
    const result = parseExplicitRating("8");
    expect(result).toEqual({ rating: 8 });
  });

  it("parses rating with dash-separated comment", () => {
    const result = parseExplicitRating("10 - great work");
    expect(result).toEqual({ rating: 10, comment: "great work" });
  });

  it("parses low numeric rating", () => {
    const result = parseExplicitRating("3");
    expect(result).toEqual({ rating: 3 });
  });

  it("returns null for sentence starter: '5 items in the list'", () => {
    const result = parseExplicitRating("5 items in the list");
    expect(result).toBeNull();
  });

  it("returns null for non-rating string", () => {
    const result = parseExplicitRating("hello");
    expect(result).toBeNull();
  });

  it("returns null for zero (out of range)", () => {
    const result = parseExplicitRating("0");
    expect(result).toBeNull();
  });

  it("parses '11' as rating 1 with comment '1' (regex captures first digit)", () => {
    // The pattern ^(10|[1-9]) matches "11" as rating=1, comment="1"
    // The out-of-range guard (< 1 || > 10) never fires since 1 is in range
    const result = parseExplicitRating("11");
    expect(result).toEqual({ rating: 1, comment: "1" });
  });

  it("parses rating with colon separator", () => {
    const result = parseExplicitRating("7: solid response");
    expect(result).toEqual({ rating: 7, comment: "solid response" });
  });

  it("parses rating with trailing whitespace", () => {
    const result = parseExplicitRating("  9  ");
    expect(result).toEqual({ rating: 9 });
  });
});

// ─── accepts ─────────────────────────────────────────────────────────────────

describe("RatingCapture.accepts", () => {
  it("always returns true", () => {
    expect(RatingCapture.accepts(makeInput("anything"))).toBe(true);
    expect(RatingCapture.accepts(makeInput(""))).toBe(true);
    expect(RatingCapture.accepts(makeInput("8"))).toBe(true);
  });
});

// ─── execute: explicit rating ─────────────────────────────────────────────────

describe("RatingCapture.execute — explicit rating", () => {
  it("returns ok with continue: true", async () => {
    const deps = makeDeps();
    const result = await RatingCapture.execute(makeInput("8"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  it("writes rating to appendFile", async () => {
    const deps = makeDeps();
    await RatingCapture.execute(makeInput("8"), deps);

    expect((deps.appendFile as ReturnType<typeof mock>).mock.calls.length).toBeGreaterThan(0);
    const [filePath, content] = (deps.appendFile as ReturnType<typeof mock>).mock.calls[0];
    expect(filePath).toContain("ratings.jsonl");
    const entry = JSON.parse(content.trim());
    expect(entry.rating).toBe(8);
    expect(entry.session_id).toBe("test-session");
  });

  it("calls ensureDir before writing", async () => {
    const deps = makeDeps();
    await RatingCapture.execute(makeInput("8"), deps);

    expect((deps.ensureDir as ReturnType<typeof mock>).mock.calls.length).toBeGreaterThan(0);
  });

  it("stores comment when provided", async () => {
    const deps = makeDeps();
    await RatingCapture.execute(makeInput("10 - great work"), deps);

    const [, content] = (deps.appendFile as ReturnType<typeof mock>).mock.calls[0];
    const entry = JSON.parse(content.trim());
    expect(entry.rating).toBe(10);
    expect(entry.comment).toBe("great work");
  });

  it("does not call inference for explicit ratings", async () => {
    const deps = makeDeps();
    await RatingCapture.execute(makeInput("8"), deps);

    expect((deps.inference as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });
});

// ─── execute: short prompt ────────────────────────────────────────────────────

describe("RatingCapture.execute — short prompt", () => {
  it("returns continue: true for empty prompt without running sentiment", async () => {
    const deps = makeDeps();
    const result = await RatingCapture.execute(makeInput(""), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
    expect((deps.inference as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  it("returns continue: true for 2-char prompt without running sentiment", async () => {
    const deps = makeDeps();
    const result = await RatingCapture.execute(makeInput("hi"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
    expect((deps.inference as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  it("does not write a rating for short prompts", async () => {
    const deps = makeDeps();
    await RatingCapture.execute(makeInput("hi"), deps);

    expect((deps.appendFile as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });
});

// ─── execute: implicit sentiment ─────────────────────────────────────────────

describe("RatingCapture.execute — implicit sentiment", () => {
  it("calls inference for prompts 3+ chars", async () => {
    const deps = makeDeps();
    await RatingCapture.execute(makeInput("great job today"), deps);

    expect((deps.inference as ReturnType<typeof mock>).mock.calls.length).toBe(1);
  });

  it("returns continue: true after sentiment analysis", async () => {
    const deps = makeDeps();
    const result = await RatingCapture.execute(makeInput("great job today"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });

  it("writes implicit rating entry when confidence >= 0.5", async () => {
    const deps = makeDeps();
    await RatingCapture.execute(makeInput("great job today"), deps);

    const calls = (deps.appendFile as ReturnType<typeof mock>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [, content] = calls[0];
    const entry = JSON.parse(content.trim());
    expect(entry.source).toBe("implicit");
    expect(entry.rating).toBe(7);
  });

  it("skips write when confidence is below 0.5", async () => {
    const deps = makeDeps({
      inference: mock(async () => ({
        success: true,
        output: "",
        parsed: {
          rating: 7,
          sentiment: "positive",
          confidence: 0.3,
          summary: "low confidence",
          detailed_context: "not sure",
        },
        latencyMs: 0,
        level: "fast" as const,
      })),
    });
    await RatingCapture.execute(makeInput("maybe good"), deps);

    expect((deps.appendFile as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  it("returns continue: true even when inference fails", async () => {
    const deps = makeDeps({
      inference: mock(async () => {
        throw new Error("inference error");
      }),
    });
    const result = await RatingCapture.execute(makeInput("something happened"), deps);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`Unexpected error: ${result.error.code}`);
    expect(result.value.continue).toBe(true);
  });
});

// ─── execute: explicit low rating learning capture ────────────────────────────

describe("RatingCapture.execute — explicit low rating learning capture", () => {
  const transcriptContent = [
    JSON.stringify({ type: "user", message: { content: "What is this?" } }),
    JSON.stringify({
      type: "assistant",
      message: { content: "SUMMARY: Explained the feature" },
    }),
  ].join("\n");

  it("calls writeFile with LEARNING path when explicit rating < 5 and transcript context present", async () => {
    const deps = makeDeps({
      fileExists: mock(() => true),
      readFile: mock(() => ok(transcriptContent)),
    });
    await RatingCapture.execute(makeInput("3", { transcript_path: "/tmp/transcript.jsonl" }), deps);

    const writeCalls = (deps.writeFile as ReturnType<typeof mock>).mock.calls;
    expect(writeCalls.length).toBeGreaterThan(0);
    const [writePath, writeContent] = writeCalls[0];
    expect(writePath).toContain("LEARNING");
    expect(writeContent).toContain("3");
  });

  it("calls ensureDir for the learning directory on low explicit rating", async () => {
    const deps = makeDeps({
      fileExists: mock(() => true),
      readFile: mock(() => ok(transcriptContent)),
    });
    await RatingCapture.execute(makeInput("3", { transcript_path: "/tmp/transcript.jsonl" }), deps);

    const ensureCalls = (deps.ensureDir as ReturnType<typeof mock>).mock.calls;
    // ensureDir is called for both signalsDir and learningsDir
    expect(ensureCalls.length).toBeGreaterThanOrEqual(2);
    const calledPaths = ensureCalls.map((args: unknown[]) => args[0] as string);
    expect(calledPaths.some((p: string) => p.includes("LEARNING"))).toBe(true);
  });

  it("does NOT call writeFile when transcript_path is absent (no detailedContext)", async () => {
    const deps = makeDeps();
    // No transcript_path — getLastAssistantContext returns "" — captureLowRatingLearning bails
    await RatingCapture.execute(makeInput("3"), deps);

    const writeCalls = (deps.writeFile as ReturnType<typeof mock>).mock.calls;
    expect(writeCalls.length).toBe(0);
  });
});

// ─── execute: explicit rating <= 3 calls captureFailure ──────────────────────

describe("RatingCapture.execute — explicit rating <= 3 calls captureFailure", () => {
  const transcriptContent = [
    JSON.stringify({ type: "user", message: { content: "What is this?" } }),
    JSON.stringify({
      type: "assistant",
      message: { content: "SUMMARY: Explained the feature" },
    }),
  ].join("\n");

  it("calls captureFailure for rating <= 3", async () => {
    const deps = makeDeps({
      fileExists: mock(() => true),
      readFile: mock(() => ok(transcriptContent)),
    });
    await RatingCapture.execute(
      makeInput("2 - terrible", { transcript_path: "/tmp/transcript.jsonl" }),
      deps,
    );

    const captureCalls = (deps.captureFailure as ReturnType<typeof mock>).mock.calls;
    expect(captureCalls.length).toBe(1);
    const [args] = captureCalls[0];
    expect(args.rating).toBe(2);
    expect(args.sessionId).toBe("test-session");
  });

  it("passes sentimentSummary (comment) to captureFailure", async () => {
    const deps = makeDeps({
      fileExists: mock(() => true),
      readFile: mock(() => ok(transcriptContent)),
    });
    await RatingCapture.execute(
      makeInput("2 - terrible", { transcript_path: "/tmp/transcript.jsonl" }),
      deps,
    );

    const [args] = (deps.captureFailure as ReturnType<typeof mock>).mock.calls[0];
    expect(args.sentimentSummary).toBe("terrible");
  });

  it("does NOT call captureFailure for rating 4 (only <= 3 triggers it)", async () => {
    const deps = makeDeps({
      fileExists: mock(() => true),
      readFile: mock(() => ok(transcriptContent)),
    });
    await RatingCapture.execute(makeInput("4", { transcript_path: "/tmp/transcript.jsonl" }), deps);

    expect((deps.captureFailure as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  it("calls writeFile (learning capture) for rating 4 but not captureFailure", async () => {
    const deps = makeDeps({
      fileExists: mock(() => true),
      readFile: mock(() => ok(transcriptContent)),
    });
    await RatingCapture.execute(makeInput("4", { transcript_path: "/tmp/transcript.jsonl" }), deps);

    const writeCalls = (deps.writeFile as ReturnType<typeof mock>).mock.calls;
    expect(writeCalls.length).toBeGreaterThan(0);
    expect((deps.captureFailure as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });
});

// ─── execute: implicit sentiment null rating ──────────────────────────────────

describe("RatingCapture.execute — implicit sentiment null rating", () => {
  it("skips appendFile when inferred rating is null", async () => {
    const deps = makeDeps({
      inference: mock(async () => ({
        success: true,
        output: "",
        parsed: {
          rating: null,
          sentiment: "neutral",
          confidence: 0.8,
          summary: "neutral",
          detailed_context: "",
        },
        latencyMs: 0,
        level: "fast" as const,
      })),
    });
    await RatingCapture.execute(makeInput("looks fine"), deps);

    expect((deps.appendFile as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  it("logs null rating to stderr", async () => {
    const deps = makeDeps({
      inference: mock(async () => ({
        success: true,
        output: "",
        parsed: {
          rating: null,
          sentiment: "neutral",
          confidence: 0.8,
          summary: "neutral",
          detailed_context: "",
        },
        latencyMs: 0,
        level: "fast" as const,
      })),
    });
    await RatingCapture.execute(makeInput("looks fine"), deps);

    const stderrCalls = (deps.stderr as ReturnType<typeof mock>).mock.calls.flat() as string[];
    expect(stderrCalls.some((msg: string) => msg.includes("null rating"))).toBe(true);
  });
});

// ─── execute: implicit sentiment low rating learning capture ──────────────────

describe("RatingCapture.execute — implicit sentiment low rating learning capture", () => {
  it("calls writeFile with LEARNING content when implicit rating < 5", async () => {
    const deps = makeDeps({
      inference: mock(async () => ({
        success: true,
        output: "",
        parsed: {
          rating: 3,
          sentiment: "negative",
          confidence: 0.7,
          summary: "frustrated",
          detailed_context: "user seemed frustrated with the response quality",
        },
        latencyMs: 0,
        level: "fast" as const,
      })),
    });
    await RatingCapture.execute(makeInput("that was pretty bad honestly"), deps);

    const writeCalls = (deps.writeFile as ReturnType<typeof mock>).mock.calls;
    expect(writeCalls.length).toBeGreaterThan(0);
    const [writePath, writeContent] = writeCalls[0];
    expect(writePath).toContain("LEARNING");
    expect(writeContent).toContain("3");
  });

  it("calls captureFailure when implicit rating <= 3", async () => {
    const deps = makeDeps({
      inference: mock(async () => ({
        success: true,
        output: "",
        parsed: {
          rating: 3,
          sentiment: "negative",
          confidence: 0.7,
          summary: "frustrated",
          detailed_context: "user seemed frustrated with the response quality",
        },
        latencyMs: 0,
        level: "fast" as const,
      })),
    });
    await RatingCapture.execute(makeInput("that was pretty bad honestly"), deps);

    const captureCalls = (deps.captureFailure as ReturnType<typeof mock>).mock.calls;
    expect(captureCalls.length).toBe(1);
    const [args] = captureCalls[0];
    expect(args.rating).toBe(3);
    expect(args.sessionId).toBe("test-session");
  });

  it("captures learning but NOT captureFailure for implicit rating 4", async () => {
    const deps = makeDeps({
      inference: mock(async () => ({
        success: true,
        output: "",
        parsed: {
          rating: 4,
          sentiment: "negative",
          confidence: 0.6,
          summary: "meh",
          detailed_context: "mild dissatisfaction with the overall approach taken",
        },
        latencyMs: 0,
        level: "fast" as const,
      })),
    });
    await RatingCapture.execute(makeInput("could have been better"), deps);

    const writeCalls = (deps.writeFile as ReturnType<typeof mock>).mock.calls;
    expect(writeCalls.length).toBeGreaterThan(0);
    expect((deps.captureFailure as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });
});

// ─── execute: transcript context passed to inference ─────────────────────────

describe("RatingCapture.execute — transcript context passed to inference", () => {
  it("calls inference with a prompt containing 'CONTEXT:' when transcript is available", async () => {
    const transcriptContent = [
      JSON.stringify({
        type: "user",
        message: { content: "previous question" },
      }),
      JSON.stringify({
        type: "assistant",
        message: { content: "SUMMARY: did the thing" },
      }),
    ].join("\n");

    const deps = makeDeps({
      fileExists: mock(() => true),
      readFile: mock(() => ok(transcriptContent)),
    });

    await RatingCapture.execute(
      makeInput("great job on that", {
        transcript_path: "/tmp/transcript.jsonl",
      }),
      deps,
    );

    const inferenceCalls = (deps.inference as ReturnType<typeof mock>).mock.calls;
    expect(inferenceCalls.length).toBe(1);
    const [inferenceArgs] = inferenceCalls[0];
    expect(inferenceArgs.prompt).toContain("CONTEXT:");
  });

  it("calls inference WITHOUT 'CONTEXT:' prefix when no transcript is available", async () => {
    const deps = makeDeps({
      fileExists: mock(() => false),
    });

    await RatingCapture.execute(makeInput("great job on that"), deps);

    const inferenceCalls = (deps.inference as ReturnType<typeof mock>).mock.calls;
    expect(inferenceCalls.length).toBe(1);
    const [inferenceArgs] = inferenceCalls[0];
    expect(inferenceArgs.prompt).not.toContain("CONTEXT:");
  });
});

// ─── execute: array ContentBlock transcript entries ───────────────────────────

describe("RatingCapture.execute — array ContentBlock transcript entries", () => {
  it("extracts text from array content blocks in transcript for context", async () => {
    // Covers lines 165-171: extractTextFromEntry array branch
    const transcriptContent = [
      JSON.stringify({
        type: "user",
        message: {
          content: [
            { type: "text", text: "What is the status?" },
            { type: "tool_use", id: "abc" },
          ],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "text", text: "SUMMARY: All systems nominal" }],
        },
      }),
    ].join("\n");

    const deps = makeDeps({
      fileExists: mock(() => true),
      readFile: mock(() => ok(transcriptContent)),
    });

    await RatingCapture.execute(
      makeInput("good response thanks", {
        transcript_path: "/tmp/transcript.jsonl",
      }),
      deps,
    );

    const inferenceCalls = (deps.inference as ReturnType<typeof mock>).mock.calls;
    expect(inferenceCalls.length).toBe(1);
    const [inferenceArgs] = inferenceCalls[0];
    // Context should contain the extracted text from block-array entries
    expect(inferenceArgs.prompt).toContain("CONTEXT:");
    expect(inferenceArgs.prompt).toContain("All systems nominal");
  });
});
