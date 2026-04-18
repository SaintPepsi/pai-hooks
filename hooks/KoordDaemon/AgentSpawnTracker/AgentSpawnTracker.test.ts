import { describe, expect, test } from "bun:test";
import { invalidInput } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { AgentSpawnTracker, type AgentSpawnTrackerDeps } from "./AgentSpawnTracker.contract";

function makeDeps(overrides: Partial<AgentSpawnTrackerDeps> = {}): AgentSpawnTrackerDeps {
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

function makeSpawnInput(overrides: Record<string, unknown> = {}): ToolHookInput {
  return {
    session_id: "test",
    hook_event_name: "PostToolUse",
    tool_name: "Agent",
    tool_input: {
      prompt: "implement feature",
      run_in_background: true,
      name: "dev-agent",
      thread_id: "12345678901234567",
      ...overrides,
    },
  };
}

describe("AgentSpawnTracker", () => {
  test("has correct name and event", () => {
    expect(AgentSpawnTracker.name).toBe("AgentSpawnTracker");
    expect(AgentSpawnTracker.event).toBe("PostToolUse");
  });

  test("accepts Agent tool inputs", () => {
    expect(AgentSpawnTracker.accepts(makeSpawnInput())).toBe(true);
  });

  test("rejects non-Agent tool inputs", () => {
    const input: ToolHookInput = {
      session_id: "test",
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    };
    expect(AgentSpawnTracker.accepts(input)).toBe(false);
  });

  test("skips foreground agent calls (no run_in_background)", async () => {
    let fetchCalled = false;
    const deps = makeDeps({
      safeFetch: async () => {
        fetchCalled = true;
        return ok({ status: 200, body: "{}", headers: {} });
      },
    });
    const input = makeSpawnInput({ run_in_background: false });
    const result = await AgentSpawnTracker.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.continue).toBe(true);
    expect(fetchCalled).toBe(false);
  });

  test("skips when no valid thread_id", async () => {
    let fetchCalled = false;
    const deps = makeDeps({
      safeFetch: async () => {
        fetchCalled = true;
        return ok({ status: 200, body: "{}", headers: {} });
      },
    });
    const input = makeSpawnInput({ thread_id: undefined });
    const result = await AgentSpawnTracker.execute(input, deps);
    expect(result.ok).toBe(true);
    expect(fetchCalled).toBe(false);
  });

  test("posts to /spawn with correct body", async () => {
    let postedUrl = "";
    let postedBody = "";
    const deps = makeDeps({
      safeFetch: async (url, opts) => {
        postedUrl = url;
        postedBody = opts.body ?? "";
        return ok({ status: 200, body: "{}", headers: {} });
      },
    });
    await AgentSpawnTracker.execute(makeSpawnInput(), deps);
    expect(postedUrl).toBe("http://localhost:4577/spawn");
    const parsed = JSON.parse(postedBody);
    expect(parsed.thread_id).toBe("12345678901234567");
    expect(parsed.agent_name).toBe("dev-agent");
  });

  test("returns continue when no daemon URL", async () => {
    const deps = makeDeps({
      getEnv: () => undefined,
      getKoordConfig: () => ({ url: null }),
    });
    const result = await AgentSpawnTracker.execute(makeSpawnInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.continue).toBe(true);
  });

  test("returns continue when fetch fails", async () => {
    const deps = makeDeps({
      safeFetch: async () => err(invalidInput("connection refused")),
    });
    const result = await AgentSpawnTracker.execute(makeSpawnInput(), deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.continue).toBe(true);
  });

  test("uses settings.json fallback URL", async () => {
    let postedUrl = "";
    const deps = makeDeps({
      getEnv: () => undefined,
      getKoordConfig: () => ({ url: "http://fallback:9999" }),
      safeFetch: async (url) => {
        postedUrl = url;
        return ok({ status: 200, body: "{}", headers: {} });
      },
    });
    await AgentSpawnTracker.execute(makeSpawnInput(), deps);
    expect(postedUrl).toBe("http://fallback:9999/spawn");
  });
});
