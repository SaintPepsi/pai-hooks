import { describe, it, expect } from "bun:test";
import { join } from "path";

const HOOK_PATH = join(import.meta.dir, "UpdateCounts.hook.ts");

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

describe("UpdateCounts hook shell", () => {
  it("exits 0 for SessionEnd event", async () => {
    const result = await runHook({
      session_id: "test",
    });
    expect(result.exitCode).toBe(0);
    // SessionEnd with silent output produces no stdout
    if (result.stdout.length > 0) {
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    }
  });

  it("produces no stdout for silent output", async () => {
    const result = await runHook({
      session_id: "test",
    });
    expect(result.exitCode).toBe(0);
    // UpdateCounts spawns a background process and returns silent — no stdout expected
    expect(result.stdout).toBe("");
  });
});
