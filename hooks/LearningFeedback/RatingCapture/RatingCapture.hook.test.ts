import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { runHookScript, uniqueSessionId } from "@hooks/lib/test-helpers";

const HOOK_PATH = join(import.meta.dir, "RatingCapture.hook.ts");

describe("RatingCapture hook shell", () => {
  it("exits 0 and produces context output for a rating prompt", async () => {
    // accepts() always returns true for UserPromptSubmitInput.
    // execute() parses "7" as an explicit rating and returns additionalContext
    // containing the algorithm format reminder (raw string, not JSON).
    // See: contracts/RatingCapture.ts accepts(), parseExplicitRating(), execute()
    const result = await runHookScript(HOOK_PATH, {
      session_id: uniqueSessionId("test-rc"),
      prompt: "7",
    });
    expect(result.exitCode).toBe(0);
    // additionalContext is a raw string containing the algorithm reminder
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stdout).toContain("ALGORITHM");
  }, 15000);

  it("produces context output even for short prompts", async () => {
    // accepts() returns true unconditionally.
    // Short prompts (< MIN_PROMPT_LENGTH of 3) skip sentiment analysis
    // but still return the algorithm reminder.
    const result = await runHookScript(HOOK_PATH, {
      session_id: uniqueSessionId("test-rc"),
      prompt: "ok",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stdout).toContain("ALGORITHM");
  }, 15000);

  it("handles empty prompt gracefully", async () => {
    // Empty prompt still passes accepts() (returns true unconditionally).
    // execute() treats empty prompt as length 0 (< MIN_PROMPT_LENGTH), skips sentiment.
    const result = await runHookScript(HOOK_PATH, {
      session_id: uniqueSessionId("test-rc"),
      prompt: "",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ALGORITHM");
  }, 15000);
});
