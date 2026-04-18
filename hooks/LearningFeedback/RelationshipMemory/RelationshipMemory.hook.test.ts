import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const HOOK_PATH = join(import.meta.dir, "RelationshipMemory.hook.ts");

let runId = 0;
function uniqueSessionId(base: string): string {
  return `${base}-${Date.now()}-${++runId}`;
}

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

describe("RelationshipMemory hook shell", () => {
  it("exits 0 for Stop event with nonexistent transcript", async () => {
    const result = await runHook({
      session_id: uniqueSessionId("rm"),
      transcript_path: "/tmp/nonexistent",
    });
    expect(result.exitCode).toBe(0);
    // Stop event with nonexistent transcript produces empty output
    expect(result.stdout).toBe("");
  });

  it("exits 0 when transcript_path is missing (rejected by accepts)", async () => {
    const result = await runHook({
      session_id: uniqueSessionId("rm"),
    });
    expect(result.exitCode).toBe(0);
    // accepts() returns false when no transcript_path — safeExit produces no stdout for Stop events
    expect(result.stdout).toBe("");
  });
});
