import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { runHookScript } from "@hooks/lib/test-helpers";

const HOOK_PATH = join(import.meta.dir, "WikiContextInjector.hook.ts");

describe("WikiContextInjector hook shell", () => {
  it("exits 0 and produces valid JSON for a Write tool input", async () => {
    const result = await runHookScript(HOOK_PATH, {
      tool_name: "Write",
      tool_input: { file_path: "/tmp/test-file.ts", content: "test" },
    });
    expect(result.exitCode).toBe(0);
    // PreToolUse hook: execute() returns ok({ continue: true }) when no wiki domain matches.
    // See hooks/WikiPipeline/WikiContextInjector/WikiContextInjector.contract.ts:271 and core/runner.ts:169-175.
    expect(result.stdout).toBe(JSON.stringify({ continue: true }));
  });

  it("exits 0 for an Edit tool input", async () => {
    const result = await runHookScript(HOOK_PATH, {
      tool_name: "Edit",
      tool_input: {
        file_path: "/tmp/test-file.ts",
        old_string: "a",
        new_string: "b",
      },
    });
    expect(result.exitCode).toBe(0);
  });

  it("does not crash with minimal input", async () => {
    // accepts() should reject non-Write/Edit tools, hook exits cleanly
    const result = await runHookScript(HOOK_PATH, {});
    expect(result.exitCode).toBe(0);
  });

  it("exits 0 for a rejected tool name", async () => {
    const result = await runHookScript(HOOK_PATH, {
      tool_name: "Read",
      tool_input: { file_path: "/tmp/test-file.ts" },
    });
    expect(result.exitCode).toBe(0);
  });
});
