import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { uniqueSessionId, runHookScript } from "@hooks/lib/test-helpers";

const HOOK_PATH = join(import.meta.dir, "QuestionAnswered.hook.ts");

describe("QuestionAnswered hook shell", () => {
  it("exits cleanly for AskUserQuestion tool input", async () => {
    const { stdout, exitCode } = await runHookScript(HOOK_PATH, {
      tool_name: "AskUserQuestion",
      tool_input: { question: "What do you think?" },
      tool_result: "User answered: yes",
      session_id: uniqueSessionId("test-qa"),
    });
    expect(exitCode).toBe(0);
    // QuestionAnswered returns silent — runner writes nothing to stdout
    expect(stdout).toBe("");
  });

  it("produces silent output for any accepted input (accepts all, settings.json filters)", async () => {
    // QuestionAnswered.accepts() returns true for all inputs — the AskUserQuestion
    // filtering happens in settings.json matcher, not the contract. So even a Bash
    // tool_name produces silent output (no stdout).
    const { stdout, exitCode } = await runHookScript(HOOK_PATH, {
      tool_name: "AskUserQuestion",
      tool_input: { question: "Another question" },
      tool_result: "User answered: no",
      session_id: uniqueSessionId("test-qa"),
    });
    expect(exitCode).toBe(0);
    expect(stdout).toBe("");
  });
});
