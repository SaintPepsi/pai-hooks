import { describe, it, expect } from "bun:test";
import { join } from "path";

const HOOK_PATH = join(import.meta.dir, "SecurityValidator.hook.ts");

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

describe("SecurityValidator hook shell", () => {
  it("produces valid JSON output for a safe Bash command", async () => {
    const { stdout, exitCode } = await runHook({
      tool_name: "Bash",
      tool_input: { command: "echo hello" },
      session_id: "test-security",
    });
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result).toBeDefined();
    expect(result.continue).toBe(true);
  });

  it("continues for a Read tool with a safe path", async () => {
    const { stdout, exitCode } = await runHook({
      tool_name: "Read",
      tool_input: { file_path: "/tmp/test-file.txt" },
      session_id: "test-security",
    });
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.continue).toBe(true);
  });

  it("continues for non-matching tool name", async () => {
    const { stdout, exitCode } = await runHook({
      tool_name: "Grep",
      tool_input: { pattern: "test" },
      session_id: "test-security",
    });
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.continue).toBe(true);
  });
});
