import { describe, it, expect } from "bun:test";
import { join } from "path";

const HOOK_PATH = join(import.meta.dir, "RatingCapture.hook.ts");

async function runHook(input: Record<string, unknown>): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", HOOK_PATH], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const writer = proc.stdin!;
  writer.write(JSON.stringify(input));
  writer.end();
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr, exitCode };
}

describe("RatingCapture hook shell", () => {
  it("exits 0 and produces context output for a rating prompt", async () => {
    // accepts() always returns true for UserPromptSubmitInput.
    // execute() parses "7" as an explicit rating and returns ContextOutput
    // containing the algorithm format reminder (raw string, not JSON).
    // See: contracts/RatingCapture.ts accepts(), parseExplicitRating(), execute()
    const result = await runHook({
      session_id: "test",
      prompt: "7",
    });
    expect(result.exitCode).toBe(0);
    // ContextOutput is a raw string containing the algorithm reminder
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stdout).toContain("ALGORITHM");
  }, 15000);

  it("produces context output even for short prompts", async () => {
    // accepts() returns true unconditionally.
    // Short prompts (< MIN_PROMPT_LENGTH of 3) skip sentiment analysis
    // but still return the algorithm reminder.
    const result = await runHook({
      session_id: "test",
      prompt: "ok",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stdout).toContain("ALGORITHM");
  }, 15000);

  it("handles empty prompt gracefully", async () => {
    // Empty prompt still passes accepts() (returns true unconditionally).
    // execute() treats empty prompt as length 0 (< MIN_PROMPT_LENGTH), skips sentiment.
    const result = await runHook({
      session_id: "test",
      prompt: "",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ALGORITHM");
  }, 15000);
});
