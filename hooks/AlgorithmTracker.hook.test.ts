import { describe, it, expect } from "bun:test";
import { join } from "path";

const HOOK_PATH = join(import.meta.dir, "AlgorithmTracker.hook.ts");

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

describe("AlgorithmTracker hook shell", () => {
  it("produces valid JSON output for a Bash tool input", async () => {
    const { stdout, exitCode } = await runHook({
      tool_name: "Bash",
      tool_input: { command: "ls -la" },
      session_id: "test-algo-tracker",
    });
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result).toBeDefined();
    expect(result.continue).toBe(true);
  });

  it("continues for non-matching tool name", async () => {
    const { stdout, exitCode } = await runHook({
      tool_name: "Read",
      tool_input: { file_path: "/tmp/test.txt" },
      session_id: "test-algo-tracker",
    });
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.continue).toBe(true);
  });
});
