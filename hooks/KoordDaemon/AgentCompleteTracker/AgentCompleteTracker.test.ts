import { describe, expect, test } from "bun:test";
import { invalidInput } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  AgentCompleteTracker,
  type AgentCompleteTrackerDeps,
} from "./AgentCompleteTracker.contract";

function makeDeps(overrides: Partial<AgentCompleteTrackerDeps> = {}): AgentCompleteTrackerDeps {
  return {
    getEnv: (name) => {
      if (name === "KOORD_DAEMON_URL") return "http://localhost:4577";
      return undefined;
    },
    safeFetch: async () => ok({ status: 200, body: "{}", headers: {} }),
    getKoordConfig: () => ({ url: null }),
    stderr: () => {},
    ...overrides,
  };
}

function makeCompletionInput(threadId?: string): ToolHookInput {
  return {
    hook_type: "PostToolUse",
    tool_name: "Agent",
    tool_input: { prompt: "do something" },
    tool_response: threadId
      ? `Completed work in thread ${threadId}`
      : "Task completed successfully",
  };
}

function makeSpawnInput(): ToolHookInput {
  return {
    hook_type: "PostToolUse",
    tool_name: "Agent",
    tool_input: { prompt: "do something", run_in_background: true },
    tool_response: "Agent spawned",
  };
}

describe("AgentCompleteTracker", () => {
  test("has correct name and event", () => {
    expect(AgentCompleteTracker.name).toBe("AgentCompleteTracker");
    expect(AgentCompleteTracker.event).toBe("PostToolUse");
  });

  test("accepts Agent tool inputs", () => {
    expect(AgentCompleteTracker.accepts(makeCompletionInput())).toBe(true);
  });

  test("rejects non-Agent tool inputs", () => {
    const input: ToolHookInput = {
      hook_type: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    };
    expect(AgentCompleteTracker.accepts(input)).toBe(false);
  });

  test("skips spawn events (run_in_background: true)", async () => {
    let fetchCalled = false;
    const deps = makeDeps({
      safeFetch: async () => {
        fetchCalled = true;
        return ok({ status: 200, body: "{}", headers: {} });
      },
    });
    const result = await AgentCompleteTracker.execute(makeSpawnInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
    expect(fetchCalled).toBe(false);
  });

  test("returns continue when no thread_id in output", async () => {
    let fetchCalled = false;
    const deps = makeDeps({
      safeFetch: async () => {
        fetchCalled = true;
        return ok({ status: 200, body: "{}", headers: {} });
      },
    });
    const result = await AgentCompleteTracker.execute(makeCompletionInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
    expect(fetchCalled).toBe(false);
  });

  test("returns continue when no daemon URL", async () => {
    const deps = makeDeps({
      getEnv: () => undefined,
      getKoordConfig: () => ({ url: null }),
    });
    // Use input with a discord-format thread ID in the output
    const input: ToolHookInput = {
      hook_type: "PostToolUse",
      tool_name: "Agent",
      tool_input: { prompt: "test" },
      tool_response: JSON.stringify({ thread_id: "12345678901234567" }),
    };
    const result = await AgentCompleteTracker.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });

  test("returns continue even when fetch fails", async () => {
    const input: ToolHookInput = {
      hook_type: "PostToolUse",
      tool_name: "Agent",
      tool_input: { prompt: "test" },
      tool_response: JSON.stringify({ thread_id: "12345678901234567" }),
    };
    const deps = makeDeps({
      safeFetch: async () => err(invalidInput("connection refused")),
    });
    const result = await AgentCompleteTracker.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.type).toBe("continue");
  });
});
