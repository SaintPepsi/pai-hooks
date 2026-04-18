import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { runHookScript, uniqueSessionId } from "@hooks/lib/test-helpers";

const HOOK_PATH = join(import.meta.dir, "QuestionAnswered.hook.ts");

describe("QuestionAnswered hook shell", () => {
  it("exits cleanly for AskUserQuestion tool input", async () => {
    const { stdout, exitCode } = await runHookScript(HOOK_PATH, {
      tool_name: "AskUserQuestion",
      tool_input: { question: "What do you think?" },
      tool_response: "User answered: yes",
      session_id: uniqueSessionId("test-qa"),
    });
    expect(exitCode).toBe(0);
    // QuestionAnswered returns ok({}) — runner outputs default continue
    expect(stdout).toBe('{"continue":true}');
  });

  it("produces default continue output for any accepted input", async () => {
    // QuestionAnswered.accepts() returns true for all inputs — the AskUserQuestion
    // filtering happens in settings.json matcher, not the contract.
    const { stdout, exitCode } = await runHookScript(HOOK_PATH, {
      tool_name: "AskUserQuestion",
      tool_input: { question: "Another question" },
      tool_response: "User answered: no",
      session_id: uniqueSessionId("test-qa"),
    });
    expect(exitCode).toBe(0);
    // Runner outputs default continue for ok({})
    expect(stdout).toBe('{"continue":true}');
  });
});
