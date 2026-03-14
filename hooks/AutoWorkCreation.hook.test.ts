import { describe, it, expect } from "bun:test";
import { join } from "path";

const HOOK_PATH = join(import.meta.dir, "AutoWorkCreation.hook.ts");

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

describe("AutoWorkCreation hook shell", () => {
  it("exits 0 and produces silent output for a valid prompt", async () => {
    // accepts() requires prompt.length >= 2. "hello" qualifies.
    // execute() returns silent output ({ type: "silent" }) which means no stdout.
    // See: contracts/AutoWorkCreation.ts accepts() and execute()
    const result = await runHook({
      session_id: "test",
      prompt: "hello",
    });
    expect(result.exitCode).toBe(0);
    // Silent output produces no stdout
    expect(result.stdout).toBe("");
  });

  it("rejects prompts shorter than 2 characters", async () => {
    // accepts() returns false when prompt.length < 2.
    // UserPromptSubmit events don't emit { continue: true } on safeExit.
    const result = await runHook({
      session_id: "test",
      prompt: "x",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("handles missing prompt gracefully", async () => {
    // accepts() treats missing prompt as empty string (length 0 < 2), rejects.
    const result = await runHook({
      session_id: "test",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });
});
