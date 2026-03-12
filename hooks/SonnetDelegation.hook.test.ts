import { describe, it, expect } from "bun:test";
import { join } from "path";

const HOOK_PATH = join(import.meta.dir, "SonnetDelegation.hook.ts");

async function runHook(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const proc = Bun.spawn(["bun", HOOK_PATH], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const writer = proc.stdin!;
  writer.write(JSON.stringify(input));
  writer.end();
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  return JSON.parse(output.trim());
}

describe("SonnetDelegation hook shell", () => {
  it("injects delegation guidance for executing-plans", async () => {
    // Runner wraps additionalContext in hookSpecificOutput per the Claude Code PostToolUse spec.
    // See: /Users/hogers/.claude/pai-hooks/core/runner.ts formatOutput()
    const result = await runHook({
      tool_name: "Skill",
      tool_input: { skill: "superpowers:executing-plans" },
      session_id: "test",
    });
    const hookOut = result.hookSpecificOutput as Record<string, unknown>;
    expect(typeof hookOut).toBe("object");
    expect(hookOut.hookEventName).toBe("PostToolUse");
    expect(typeof hookOut.additionalContext).toBe("string");
    expect((hookOut.additionalContext as string).toLowerCase()).toContain("sonnet");
  });

  it("passes through for non-matching skills", async () => {
    // Non-matching input hits safeExit() which emits { continue: true } for tool events.
    // See: /Users/hogers/.claude/pai-hooks/core/runner.ts safeExit()
    const result = await runHook({
      tool_name: "Skill",
      tool_input: { skill: "Research" },
      session_id: "test",
    });
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });
});
