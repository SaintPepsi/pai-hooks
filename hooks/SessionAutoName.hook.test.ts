import { describe, it, expect } from "bun:test";
import { join } from "path";

const HOOK_PATH = join(import.meta.dir, "SessionAutoName.hook.ts");

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

describe("SessionAutoName hook shell", () => {
  it("exits 0 and produces silent output for a valid prompt", async () => {
    // accepts() requires truthy session_id. "test" qualifies.
    // execute() returns SilentOutput ({ type: "silent" }) — no stdout.
    // It attempts inference for naming but catches failures gracefully,
    // falling back to extractFallbackName().
    // See: contracts/SessionAutoName.ts accepts() and execute()
    const result = await runHook({
      session_id: "test",
      prompt: "hello world",
    });
    expect(result.exitCode).toBe(0);
    // Silent output produces no stdout
    expect(result.stdout).toBe("");
  }, 15000);

  it("rejects input without session_id", async () => {
    // accepts() returns false when session_id is falsy.
    // UserPromptSubmit events don't emit { continue: true } on safeExit.
    const result = await runHook({
      prompt: "hello world",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("handles empty prompt with valid session_id", async () => {
    // accepts() passes (session_id is truthy).
    // execute() returns silent early because prompt is empty after sanitization.
    const result = await runHook({
      session_id: "test",
      prompt: "",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  }, 15000);
});
