import { describe, it, expect } from "bun:test";
import { join } from "path";
import { homedir } from "os";

// StopOrchestrator imports handlers from @hooks/handlers/ which resolve via the
// parent tsconfig at ~/.claude/tsconfig.json (not the submodule tsconfig).
// We must spawn from the parent directory using the installed hook path.
// See: contracts/StopOrchestrator.ts lines 16-19 for the @hooks/handlers imports.
const PAI_DIR = join(homedir(), ".claude");
const HOOK_PATH = join(PAI_DIR, "pai-hooks", "hooks", "StopOrchestrator", "StopOrchestrator", "StopOrchestrator.hook.ts");

async function runHook(input: Record<string, unknown>): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", HOOK_PATH], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: PAI_DIR,
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

describe("StopOrchestrator hook shell", () => {
  it("exits 0 for Stop event with nonexistent transcript", async () => {
    const result = await runHook({
      session_id: "test",
      transcript_path: "/tmp/nonexistent",
    });
    expect(result.exitCode).toBe(0);
    // Stop event with silent output produces no stdout
    if (result.stdout.length > 0) {
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    }
  });

  it("exits 0 when transcript_path is missing (rejected by accepts)", async () => {
    const result = await runHook({
      session_id: "test",
    });
    expect(result.exitCode).toBe(0);
    // accepts() returns false without transcript_path — safeExit for Stop events emits nothing
    expect(result.stdout).toBe("");
  });
});
