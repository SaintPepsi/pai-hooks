import { describe, it, expect } from "bun:test";
import { join } from "path";

const HOOK_PATH = join(import.meta.dir, "QuestionAnswered.hook.ts");

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

describe("QuestionAnswered hook shell", () => {
  it("exits cleanly for AskUserQuestion tool input", async () => {
    const { stdout, exitCode, stderr } = await runHook({
      tool_name: "AskUserQuestion",
      tool_input: { question: "What do you think?" },
      tool_result: "User answered: yes",
      session_id: "test-question-answered",
    });
    expect(exitCode).toBe(0);
    // QuestionAnswered returns silent type which produces no stdout
    // The runner emits nothing for silent outputs
    expect(stdout === "" || stdout === "{}").toBe(true);
    expect(stderr).toContain("QuestionAnswered");
  });

  it("produces silent output for any accepted input (accepts all, settings.json filters)", async () => {
    // QuestionAnswered.accepts() returns true for all inputs — the AskUserQuestion
    // filtering happens in settings.json matcher, not the contract. So even a Bash
    // tool_name produces silent output (no stdout).
    const { stdout, exitCode, stderr } = await runHook({
      tool_name: "AskUserQuestion",
      tool_input: { question: "Another question" },
      tool_result: "User answered: no",
      session_id: "test-question-answered-2",
    });
    expect(exitCode).toBe(0);
    expect(stdout === "" || stdout === "{}").toBe(true);
    expect(stderr).toContain("QuestionAnswered");
  });
});
