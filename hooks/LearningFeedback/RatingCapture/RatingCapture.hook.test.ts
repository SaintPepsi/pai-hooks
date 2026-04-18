import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { runHookScript, uniqueSessionId } from "@hooks/lib/test-helpers";

const HOOK_PATH = join(import.meta.dir, "RatingCapture.hook.ts");

describe("RatingCapture hook shell", () => {
  it("exits 0 and returns continue: true for a rating prompt", async () => {
    // accepts() always returns true for UserPromptSubmitInput.
    // execute() parses "7" as an explicit rating and returns { continue: true }.
    const result = await runHookScript(HOOK_PATH, {
      session_id: uniqueSessionId("test-rc"),
      prompt: "7",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"continue":true');
  }, 15000);

  it("returns continue: true for short prompts", async () => {
    // accepts() returns true unconditionally.
    // Short prompts (< MIN_PROMPT_LENGTH of 3) skip sentiment analysis.
    const result = await runHookScript(HOOK_PATH, {
      session_id: uniqueSessionId("test-rc"),
      prompt: "ok",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"continue":true');
  }, 15000);

  it("handles empty prompt gracefully", async () => {
    // Empty prompt still passes accepts() (returns true unconditionally).
    // execute() treats empty prompt as length 0 (< MIN_PROMPT_LENGTH), skips sentiment.
    const result = await runHookScript(HOOK_PATH, {
      session_id: uniqueSessionId("test-rc"),
      prompt: "",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"continue":true');
  }, 15000);
});
