import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const HOOK_PATH = join(import.meta.dir, "WorkCompletionLearning.hook.ts");

async function runHook(
  input: Record<string, unknown>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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

describe("WorkCompletionLearning hook shell", () => {
  it("exits 0 for SessionEnd event with nonexistent transcript", async () => {
    const result = await runHook({
      session_id: "test",
      transcript_path: "/tmp/nonexistent",
    });
    expect(result.exitCode).toBe(0);
    // SessionEnd event: ok({}) with no tool_name produces no stdout.
    // See hooks/WorkLifecycle/WorkCompletionLearning/WorkCompletionLearning.contract.ts — execute() returns ok({}) when no current-work file exists, and core/runner.ts:169-175 suppresses "{}" for non-tool events.
    expect(result.stdout).toBe("");
  });

  it("exits 0 with no active work session", async () => {
    const result = await runHook({
      session_id: "test",
    });
    expect(result.exitCode).toBe(0);
    // No current-work state file exists for session "test", so it exits silently
    expect(result.stdout).toBe("");
  });
});
