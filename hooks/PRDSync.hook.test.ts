import { describe, it, expect } from "bun:test";
import { join } from "path";

const HOOK_PATH = join(import.meta.dir, "PRDSync.hook.ts");

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

describe("PRDSync hook shell", () => {
  it("continues for non-PRD file paths", async () => {
    // accepts() requires tool_name Write/Edit AND file_path matching MEMORY/WORK/**\/PRD.md.
    // A non-PRD file path fails accepts(), so safeExit() emits { continue: true }
    // because PostToolUse is a tool event.
    // See: contracts/PRDSync.ts accepts() and core/runner.ts safeExit()
    const result = await runHook({
      session_id: "test",
      tool_name: "Write",
      tool_input: { file_path: "/tmp/test.md", content: "test" },
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.continue).toBe(true);
  });

  it("continues for non-Write/Edit tools", async () => {
    // accepts() rejects tool_name other than Write or Edit.
    // safeExit() for PostToolUse emits { continue: true }.
    const result = await runHook({
      session_id: "test",
      tool_name: "Read",
      tool_input: { file_path: "/tmp/MEMORY/WORK/session/PRD.md" },
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.continue).toBe(true);
  });

  it("handles PRD path with Write tool", async () => {
    // accepts() passes for Write + MEMORY/WORK path ending in PRD.md.
    // execute() will try to read the file from disk. Since it doesn't exist,
    // it returns { type: "continue", continue: true } with a stderr message.
    // See: contracts/PRDSync.ts execute() — "PRD file not found on disk"
    const result = await runHook({
      session_id: "test",
      tool_name: "Write",
      tool_input: { file_path: "/tmp/MEMORY/WORK/session/PRD.md", content: "test" },
    });
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.continue).toBe(true);
  });
});
