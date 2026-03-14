import { describe, it, expect } from "bun:test";
import { join } from "path";

const HOOK_PATH = join(import.meta.dir, "ArticleWriter.hook.ts");

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

describe("ArticleWriter hook shell", () => {
  it("exits 0 with silent output for SessionEnd event", async () => {
    // ArticleWriter accepts any input with session_id.
    // It returns silent output (no stdout) because multiple gates
    // (machine check, frequency counter, substance check) will cause early return.
    // See: contracts/ArticleWriter.ts accepts() and execute()
    const result = await runHook({
      session_id: "test",
      transcript_path: "/tmp/nonexistent",
    });
    expect(result.exitCode).toBe(0);
    // Silent output produces no stdout
    expect(result.stdout).toBe("");
  });

  it("accepts input with session_id", async () => {
    // accepts() returns true when session_id is truthy.
    // The hook should not crash regardless of gating results.
    const result = await runHook({
      session_id: "integration-test-session",
      transcript_path: "/tmp/nonexistent",
    });
    expect(result.exitCode).toBe(0);
  });

  it("rejects input without session_id", async () => {
    // accepts() returns false when session_id is falsy.
    // SessionEnd events don't emit { continue: true } on safeExit.
    const result = await runHook({
      transcript_path: "/tmp/nonexistent",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });
});
