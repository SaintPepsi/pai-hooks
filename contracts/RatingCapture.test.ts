import { describe, it, expect, mock } from "bun:test";
import { RatingCapture, parseExplicitRating } from "@hooks/contracts/RatingCapture";
import type { RatingCaptureDeps } from "@hooks/contracts/RatingCapture";
import type { UserPromptSubmitInput } from "@hooks/core/types/hook-inputs";
import { ok, err } from "@hooks/core/result";
import { PaiError, ErrorCode } from "@hooks/core/error";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeInput(prompt: string, overrides: Partial<UserPromptSubmitInput> = {}): UserPromptSubmitInput {
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
    getPrincipal: mock(() => ({ name: "TestUser", pronunciation: "", timezone: "UTC" })),
    getIdentity: mock(() => ({ name: "TestBot", fullName: "TestBot", displayName: "TestBot", mainDAVoiceID: "", color: "#000000" })),
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
    readFile: mock(() => err(new PaiError(ErrorCode.FileNotFound, "not found"))),
    writeFile: mock(() => ok(undefined)),
    appendFile: mock(() => ok(undefined)),
    ensureDir: mock(() => ok(undefined)),
    spawnTrending: mock(() => {}),
    readAlgoVersion: mock(() => "v1.8.0"),
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
  it("returns ok ContextOutput containing algorithm reminder", async () => {
    const deps = makeDeps();
    const result = await RatingCapture.execute(makeInput("8"), deps);

    expect(result.ok).toBe(true);
    expect(result.value?.type).toBe("context");
    expect(typeof result.value?.content).toBe("string");
    expect(result.value?.content.length).toBeGreaterThan(0);
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
  it("returns ContextOutput for empty prompt without running sentiment", async () => {
    const deps = makeDeps();
    const result = await RatingCapture.execute(makeInput(""), deps);

    expect(result.ok).toBe(true);
    expect(result.value?.type).toBe("context");
    expect((deps.inference as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  it("returns ContextOutput for 2-char prompt without running sentiment", async () => {
    const deps = makeDeps();
    const result = await RatingCapture.execute(makeInput("hi"), deps);

    expect(result.ok).toBe(true);
    expect(result.value?.type).toBe("context");
    expect((deps.inference as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  it("does not write a rating for short prompts", async () => {
    const deps = makeDeps();
    await RatingCapture.execute(makeInput("hi"), deps);

    expect((deps.appendFile as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });
});

// ─── execute: algorithm reminder content ─────────────────────────────────────

describe("RatingCapture algorithm reminder", () => {
  it("contains the version string from readAlgoVersion", async () => {
    const deps = makeDeps();
    const result = await RatingCapture.execute(makeInput("8"), deps);

    expect(result.value?.content).toContain("v1.8.0");
  });

  it("contains ALGORITHM FORMAT REQUIRED text", async () => {
    const deps = makeDeps();
    const result = await RatingCapture.execute(makeInput("8"), deps);

    expect(result.value?.content).toContain("ALGORITHM FORMAT REQUIRED");
  });

  it("wraps content in user-prompt-submit-hook tags", async () => {
    const deps = makeDeps();
    const result = await RatingCapture.execute(makeInput("hello world this is a long enough prompt"), deps);

    expect(result.value?.content).toContain("<user-prompt-submit-hook>");
    expect(result.value?.content).toContain("</user-prompt-submit-hook>");
  });
});

// ─── execute: implicit sentiment ─────────────────────────────────────────────

describe("RatingCapture.execute — implicit sentiment", () => {
  it("calls inference for prompts 3+ chars", async () => {
    const deps = makeDeps();
    await RatingCapture.execute(makeInput("great job today"), deps);

    expect((deps.inference as ReturnType<typeof mock>).mock.calls.length).toBe(1);
  });

  it("returns ContextOutput after sentiment analysis", async () => {
    const deps = makeDeps();
    const result = await RatingCapture.execute(makeInput("great job today"), deps);

    expect(result.ok).toBe(true);
    expect(result.value?.type).toBe("context");
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

  it("returns ContextOutput even when inference fails", async () => {
    const deps = makeDeps({
      inference: mock(async () => { throw new Error("inference error"); }),
    });
    const result = await RatingCapture.execute(makeInput("something happened"), deps);

    expect(result.ok).toBe(true);
    expect(result.value?.type).toBe("context");
  });
});
