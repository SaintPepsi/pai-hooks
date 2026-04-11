import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const HOOK_PATH = join(import.meta.dir, "LoadContext.hook.ts");

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

describe("LoadContext hook shell", () => {
  it("exits 0 and produces valid output for SessionStart", async () => {
    // accepts() always returns true for any SessionStartInput.
    // execute() loads PAI context files and returns a SyncHookJSONOutput with
    // hookSpecificOutput.additionalContext (SessionStart) carrying the full
    // <system-reminder> payload, or an empty {} if no context files found or
    // if running as subagent. See: LoadContext.contract.ts accepts() and execute()
    const result = await runHook({
      session_id: uniqueSessionId("lc"),
    });
    expect(result.exitCode).toBe(0);
    // Output is either the JSON envelope (contains system-reminder) or {} (silent/subagent)
    if (result.stdout.length > 0) {
      expect(result.stdout).toContain("system-reminder");
    }
  });

  it("does not crash with minimal input", async () => {
    // accepts() returns true unconditionally, so even empty objects pass.
    // The hook should handle missing session_id gracefully.
    const result = await runHook({});
    expect(result.exitCode).toBe(0);
  });
});
