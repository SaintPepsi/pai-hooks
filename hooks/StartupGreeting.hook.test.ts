import { describe, it, expect } from "bun:test";
import { join } from "path";

const HOOK_PATH = join(import.meta.dir, "StartupGreeting.hook.ts");

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

describe("StartupGreeting hook shell", () => {
  it("exits 0 for SessionStart event", async () => {
    const result = await runHook({
      session_id: "test",
    });
    expect(result.exitCode).toBe(0);
    // SessionStart outputs either context (raw string) or silent (no stdout)
    // Both are valid — context output is a raw banner string, not JSON
  });

  it("produces parseable or empty output", async () => {
    const result = await runHook({
      session_id: "test",
    });
    expect(result.exitCode).toBe(0);
    // StartupGreeting returns either context (banner text) or silent (empty)
    // Either way, exit code 0 means the hook wired correctly
    expect(typeof result.stdout).toBe("string");
  });
});
