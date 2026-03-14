import { describe, it, expect } from "bun:test";
import { join } from "path";

const HOOK_PATH = join(import.meta.dir, "SessionSummary.hook.ts");

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

describe("SessionSummary hook shell", () => {
  it("exits 0 for SessionEnd event with test input", async () => {
    const result = await runHook({
      session_id: "test",
      transcript_path: "/tmp/nonexistent",
    });
    expect(result.exitCode).toBe(0);
    // SessionEnd with silent output produces no stdout
    if (result.stdout.length > 0) {
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    }
  });

  it("exits 0 even without transcript_path (accepts always true)", async () => {
    const result = await runHook({
      session_id: "test",
    });
    expect(result.exitCode).toBe(0);
  });
});
