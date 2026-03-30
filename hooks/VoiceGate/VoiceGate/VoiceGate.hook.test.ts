import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const HOOK_PATH = join(import.meta.dir, "VoiceGate.hook.ts");

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

describe("VoiceGate hook shell", () => {
  it("produces valid JSON output for a curl to localhost:8888", async () => {
    const { stdout, exitCode } = await runHook({
      tool_name: "Bash",
      tool_input: {
        command: 'curl -s http://localhost:8888/notify -d \'{"message": "hello"}\'',
      },
      session_id: uniqueSessionId("vg"),
    });
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result).toBeDefined();
    // Result depends on session detection — either continue or block, both valid JSON
    expect(typeof result).toBe("object");
  });

  it("continues for non-matching command without localhost:8888", async () => {
    const { stdout, exitCode } = await runHook({
      tool_name: "Bash",
      tool_input: { command: "echo hello world" },
      session_id: uniqueSessionId("vg"),
    });
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.continue).toBe(true);
  });
});
