import { describe, it, expect } from "bun:test";
import { join } from "path";

const HOOK_PATH = join(import.meta.dir, "AgentExecutionGuard.hook.ts");

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

describe("AgentExecutionGuard hook shell", () => {
  it("produces warning context for foreground Task without run_in_background", async () => {
    const { stdout, exitCode } = await runHook({
      tool_name: "Task",
      tool_input: {
        description: "Research something",
        subagent_type: "research",
      },
      session_id: "test-agent-guard",
    });
    expect(exitCode).toBe(0);
    // Non-fast agent without run_in_background gets context warning (raw string output)
    expect(stdout).toContain("FOREGROUND AGENT DETECTED");
    expect(stdout).toContain("run_in_background");
  });

  it("continues for Task with run_in_background set", async () => {
    const { stdout, exitCode } = await runHook({
      tool_name: "Task",
      tool_input: {
        description: "Research something",
        subagent_type: "research",
        run_in_background: true,
      },
      session_id: "test-agent-guard",
    });
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.continue).toBe(true);
  });

  it("continues for fast-tier Explore agent", async () => {
    const { stdout, exitCode } = await runHook({
      tool_name: "Task",
      tool_input: {
        description: "Quick lookup",
        subagent_type: "Explore",
      },
      session_id: "test-agent-guard",
    });
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.continue).toBe(true);
  });
});
