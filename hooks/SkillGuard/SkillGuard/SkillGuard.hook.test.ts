import { describe, it, expect } from "bun:test";
import { join } from "path";

const HOOK_PATH = join(import.meta.dir, "SkillGuard.hook.ts");

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

describe("SkillGuard hook shell", () => {
  it("blocks the keybindings-help false-positive skill", async () => {
    const { stdout, exitCode } = await runHook({
      tool_name: "Skill",
      tool_input: { skill: "keybindings-help" },
      session_id: "test-skill-guard",
    });
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result).toBeDefined();
    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(result.hookSpecificOutput.permissionDecisionReason).toContain("false-positive");
  });

  it("continues for a legitimate skill", async () => {
    const { stdout, exitCode } = await runHook({
      tool_name: "Skill",
      tool_input: { skill: "commit" },
      session_id: "test-skill-guard",
    });
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.continue).toBe(true);
  });
});
