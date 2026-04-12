/**
 * Behavioral parity tests — verifies pai-hooks contracts produce the same
 * results as the original JS hooks in /Users/hogers/Projects/koord/.claude/hooks/.
 *
 * Each test simulates the exact input Claude Code would pipe to the original
 * JS hook and verifies the contract produces equivalent behavior.
 */

import { describe, expect, test } from "bun:test";
import type { FetchResult } from "@hooks/core/adapters/fetch";
import type { ResultError } from "@hooks/core/error";
import type { Result } from "@hooks/core/result";
import { ok } from "@hooks/core/result";
import type { SessionStartInput, ToolHookInput } from "@hooks/core/types/hook-inputs";

// ─── AgentPrepromptInjector Parity ───────────────────────────────────────────
// Original: /Users/hogers/Projects/koord/.claude/hooks/AgentPrepromptInjector.hook.js

describe("AgentPrepromptInjector parity with original JS hook", () => {
  test("template variable replacement matches original exactly", async () => {
    const { AgentPrepromptInjector } = await import(
      "@hooks/hooks/KoordDaemon/AgentPrepromptInjector/AgentPrepromptInjector.contract"
    );

    // Simulate the exact input Claude Code would send for a background Agent spawn
    const input: ToolHookInput = {
      session_id: "abc-123",
      tool_name: "Agent",
      tool_input: {
        run_in_background: true,
        prompt: "Research the API endpoints",
        name: "research-worker",
        thread_id: "11223344556677889",
        task_description: "Investigate REST patterns",
      },
    };

    const template = "Worker {{agent_name}} on thread {{thread_id}}: {{task_description}}";
    const deps = {
      fileExists: () => true,
      readFile: () => ok(template),
      getKoordConfig: () => ({ prepromptPath: "/mock/worker.md" }),
      getCwd: () => "/project",
      stderr: () => {},
    };

    const result = AgentPrepromptInjector.execute(input, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Original JS hook (AgentPrepromptInjector.hook.js:64-67) does:
    //   .replace(/\{\{agent_name\}\}/g, agentName)
    //   .replace(/\{\{thread_id\}\}/g, threadId)
    //   .replace(/\{\{task_description\}\}/g, taskDesc)
    const hso1 = result.value.hookSpecificOutput;
    if (!hso1 || hso1.hookEventName !== "PreToolUse") throw new Error("Expected PreToolUse hso");

    const prompt = hso1.updatedInput?.prompt as string;

    // Original JS hook (AgentPrepromptInjector.hook.js:70-72):
    //   originalPrompt + "\n\n---\n\n" + preprompt
    expect(prompt).toBe(
      "Research the API endpoints\n\n---\n\nWorker research-worker on thread 11223344556677889: Investigate REST patterns",
    );
  });

  test("extractAgentName falls back to name field like original", async () => {
    // Original JS hook (AgentPrepromptInjector.hook.js:100-108):
    //   Check toolInput.name first, then scan prompt for agent_name pattern
    const { AgentPrepromptInjector } = await import(
      "@hooks/hooks/KoordDaemon/AgentPrepromptInjector/AgentPrepromptInjector.contract"
    );

    const input: ToolHookInput = {
      session_id: "abc",
      tool_name: "Agent",
      tool_input: { run_in_background: true, name: "  my-agent  ", prompt: "test" },
    };
    const deps = {
      fileExists: () => true,
      readFile: () => ok("{{agent_name}}"),
      getKoordConfig: () => ({ prepromptPath: "/mock.md" }),
      getCwd: () => "/",
      stderr: () => {},
    };

    const result = AgentPrepromptInjector.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const hso = result.value.hookSpecificOutput;
      if (hso && hso.hookEventName === "PreToolUse") {
        // Original trims the name field (AgentPrepromptInjector.hook.js:102)
        expect(hso.updatedInput?.prompt as string).toContain("my-agent");
      }
    }
  });

  test("defaults match original: agent_name='worker', thread_id='unknown', task='Background task'", async () => {
    // Original JS hook (AgentPrepromptInjector.hook.js:59-61):
    //   agentName = extractAgentName(toolInput) || "worker"
    //   threadId = extractThreadId(toolInput) || "unknown"
    //   taskDesc = extractTask(toolInput) || "Background task"
    const { AgentPrepromptInjector } = await import(
      "@hooks/hooks/KoordDaemon/AgentPrepromptInjector/AgentPrepromptInjector.contract"
    );

    const input: ToolHookInput = {
      session_id: "abc",
      tool_name: "Agent",
      tool_input: { run_in_background: true, prompt: "" }, // no name, no thread_id, empty prompt
    };
    const deps = {
      fileExists: () => true,
      readFile: () => ok("{{agent_name}}|{{thread_id}}|{{task_description}}"),
      getKoordConfig: () => ({ prepromptPath: "/mock.md" }),
      getCwd: () => "/",
      stderr: () => {},
    };

    const result = AgentPrepromptInjector.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const hso = result.value.hookSpecificOutput;
      if (hso && hso.hookEventName === "PreToolUse") {
        const prompt = hso.updatedInput?.prompt as string;
        expect(prompt).toContain("worker|unknown|Background task");
      }
    }
  });

  test("updatedInput output matches original JSON shape via runner", async () => {
    // Original JS hook outputs (AgentPrepromptInjector.hook.js:75-82):
    //   { hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: { prompt: "..." } } }
    // The runner's formatOutput for hookSpecificOutput with updatedInput produces the same structure.

    // Import runner's formatOutput indirectly by checking the output structure
    const { AgentPrepromptInjector } = await import(
      "@hooks/hooks/KoordDaemon/AgentPrepromptInjector/AgentPrepromptInjector.contract"
    );

    const input: ToolHookInput = {
      session_id: "abc",
      tool_name: "Agent",
      tool_input: { run_in_background: true, prompt: "original" },
    };
    const deps = {
      fileExists: () => true,
      readFile: () => ok("injected"),
      getKoordConfig: () => ({ prepromptPath: "/mock.md" }),
      getCwd: () => "/",
      stderr: () => {},
    };

    const result = AgentPrepromptInjector.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const hso = result.value.hookSpecificOutput;
      if (hso && hso.hookEventName === "PreToolUse") {
        // Verify the shape matches what the runner would format, matching original JS output
        expect(hso.updatedInput).toEqual({ prompt: "original\n\n---\n\ninjected" });
      } else {
        throw new Error("Expected PreToolUse hookSpecificOutput");
      }
    }
  });
});

// ─── AgentSpawnTracker Parity ────────────────────────────────────────────────
// Original: /Users/hogers/Projects/koord/.claude/hooks/AgentSpawnTracker.hook.js

describe("AgentSpawnTracker parity with original JS hook", () => {
  const safeFetchOk = async () =>
    ok({ status: 200, body: "", headers: {} }) as Result<FetchResult, ResultError>;

  test("POST body matches original: { thread_id, agent_name, task }", async () => {
    // Original JS hook (AgentSpawnTracker.hook.js:97-103):
    //   body = { thread_id, agent_name }; if (task) body.task = task;
    const { AgentSpawnTracker } = await import(
      "@hooks/hooks/KoordDaemon/AgentSpawnTracker/AgentSpawnTracker.contract"
    );

    let sentBody = "";
    const input: ToolHookInput = {
      session_id: "sess-1",
      tool_name: "Agent",
      tool_input: {
        run_in_background: true,
        name: "worker-alpha",
        thread_id: "99887766554433221",
        task_description: "Build the feature",
      },
    };

    const deps = {
      getEnv: (name: string) => (name === "KOORD_DAEMON_URL" ? "http://localhost:9999" : undefined),
      safeFetch: async (_url: string, opts: { body?: string }) => {
        sentBody = opts.body ?? "";
        return safeFetchOk();
      },
      getKoordConfig: () => ({ url: null }),
      stderr: () => {},
    };

    await AgentSpawnTracker.execute(input, deps);
    const parsed = JSON.parse(sentBody);

    // Matches original body shape (AgentSpawnTracker.hook.js:97-103)
    expect(parsed.thread_id).toBe("99887766554433221");
    expect(parsed.agent_name).toBe("worker-alpha");
    expect(parsed.task).toBe("Build the feature");
  });

  test("agent_name defaults to 'background-agent' like original", async () => {
    // Original JS hook (AgentSpawnTracker.hook.js:99):
    //   agent_name: agentName || "background-agent"
    const { AgentSpawnTracker } = await import(
      "@hooks/hooks/KoordDaemon/AgentSpawnTracker/AgentSpawnTracker.contract"
    );

    let sentBody = "";
    const input: ToolHookInput = {
      session_id: "sess-1",
      tool_name: "Agent",
      tool_input: {
        run_in_background: true,
        thread_id: "99887766554433221",
        prompt: "do stuff",
      },
    };

    const deps = {
      getEnv: (name: string) => (name === "KOORD_DAEMON_URL" ? "http://localhost:9999" : undefined),
      safeFetch: async (_url: string, opts: { body?: string }) => {
        sentBody = opts.body ?? "";
        return safeFetchOk();
      },
      getKoordConfig: () => ({ url: null }),
      stderr: () => {},
    };

    await AgentSpawnTracker.execute(input, deps);
    expect(JSON.parse(sentBody).agent_name).toBe("background-agent");
  });

  test("skips /spawn when no valid thread_id like original", async () => {
    // Original JS hook (AgentSpawnTracker.hook.js:82-86):
    //   if (!threadId) { stderr; continue; exit; }
    const { AgentSpawnTracker } = await import(
      "@hooks/hooks/KoordDaemon/AgentSpawnTracker/AgentSpawnTracker.contract"
    );

    let fetchCalled = false;
    const input: ToolHookInput = {
      session_id: "sess-1",
      tool_name: "Agent",
      tool_input: { run_in_background: true, prompt: "no ids in here" },
    };

    const deps = {
      getEnv: (name: string) => (name === "KOORD_DAEMON_URL" ? "http://localhost:9999" : undefined),
      safeFetch: async () => {
        fetchCalled = true;
        return safeFetchOk();
      },
      getKoordConfig: () => ({ url: null }),
      stderr: () => {},
    };

    await AgentSpawnTracker.execute(input, deps);
    expect(fetchCalled).toBe(false); // Must NOT call daemon
  });
});

// ─── AgentCompleteTracker Parity ─────────────────────────────────────────────
// Original: /Users/hogers/Projects/koord/.claude/hooks/AgentCompleteTracker.hook.js

describe("AgentCompleteTracker parity with original JS hook", () => {
  const safeFetchOk = async () =>
    ok({ status: 200, body: "", headers: {} }) as Result<FetchResult, ResultError>;

  test("skips spawn events (run_in_background true) like original", async () => {
    // Original JS hook (AgentCompleteTracker.hook.js:62-68):
    //   if (toolInput.run_in_background) { continue; exit; }
    const { AgentCompleteTracker } = await import(
      "@hooks/hooks/KoordDaemon/AgentCompleteTracker/AgentCompleteTracker.contract"
    );

    let fetchCalled = false;
    const input: ToolHookInput = {
      session_id: "sess-1",
      tool_name: "Agent",
      tool_input: { run_in_background: true, thread_id: "12345678901234567" },
    };

    const deps = {
      getEnv: () => "http://localhost:9999",
      safeFetch: async () => {
        fetchCalled = true;
        return safeFetchOk();
      },
      getKoordConfig: () => ({ url: null }),
      stderr: () => {},
    };

    await AgentCompleteTracker.execute(input, deps);
    expect(fetchCalled).toBe(false); // Must NOT call daemon for spawn events
  });

  test("extracts thread_id from tool_output, NOT tool_input, like original", async () => {
    // Original JS hook (AgentCompleteTracker.hook.js:114-136):
    //   extractThreadId checks tool_output and top-level, but NOT tool_input
    //   This prevents /complete firing at spawn time
    const { AgentCompleteTracker } = await import(
      "@hooks/hooks/KoordDaemon/AgentCompleteTracker/AgentCompleteTracker.contract"
    );

    let sentBody = "";
    const input: ToolHookInput = {
      session_id: "sess-1",
      tool_name: "Agent",
      // tool_input has a thread_id but it should be IGNORED
      tool_input: { thread_id: "11111111111111111" },
      // tool_response has the real completion thread_id
      tool_response: 'Agent completed work on thread_id="22222222222222222"',
    };

    const deps = {
      getEnv: (name: string) => (name === "KOORD_DAEMON_URL" ? "http://localhost:9999" : undefined),
      safeFetch: async (_url: string, opts: { body?: string }) => {
        sentBody = opts.body ?? "";
        return safeFetchOk();
      },
      getKoordConfig: () => ({ url: null }),
      stderr: () => {},
    };

    await AgentCompleteTracker.execute(input, deps);
    const parsed = JSON.parse(sentBody);

    // Must use tool_response thread_id, NOT tool_input thread_id
    expect(parsed.thread_id).toBe("22222222222222222");
  });

  test("POST body matches original: { thread_id }", async () => {
    // Original JS hook (AgentCompleteTracker.hook.js:94):
    //   body: JSON.stringify({ thread_id: threadId })
    const { AgentCompleteTracker } = await import(
      "@hooks/hooks/KoordDaemon/AgentCompleteTracker/AgentCompleteTracker.contract"
    );

    let sentBody = "";
    let sentUrl = "";
    const input: ToolHookInput = {
      session_id: "sess-1",
      tool_name: "Agent",
      tool_input: {},
      tool_response: 'thread_id="33333333333333333"',
    };

    const deps = {
      getEnv: (name: string) => (name === "KOORD_DAEMON_URL" ? "http://localhost:8888" : undefined),
      safeFetch: async (url: string, opts: { body?: string }) => {
        sentUrl = url;
        sentBody = opts.body ?? "";
        return safeFetchOk();
      },
      getKoordConfig: () => ({ url: null }),
      stderr: () => {},
    };

    await AgentCompleteTracker.execute(input, deps);

    // URL matches original pattern (AgentCompleteTracker.hook.js:91)
    expect(sentUrl).toBe("http://localhost:8888/complete");

    // Body matches original shape (AgentCompleteTracker.hook.js:94)
    expect(JSON.parse(sentBody)).toEqual({ thread_id: "33333333333333333" });
  });
});

// ─── SessionIdRegister Parity ────────────────────────────────────────────────
// Original: /Users/hogers/Projects/koord/.claude/hooks/SessionIdRegister.hook.js

describe("SessionIdRegister parity with original JS hook", () => {
  const safeFetchOk = async () =>
    ok({ status: 200, body: "", headers: {} }) as Result<FetchResult, ResultError>;

  test("POST body matches original: { sessionId, threadId }", async () => {
    // Original JS hook (SessionIdRegister.hook.js:79):
    //   body: JSON.stringify({ sessionId, threadId })
    const { SessionIdRegister } = await import(
      "@hooks/hooks/KoordDaemon/SessionIdRegister/SessionIdRegister.contract"
    );

    let sentBody = "";
    let sentUrl = "";
    const input: SessionStartInput = { session_id: "my-session-uuid-here" };

    const deps = {
      getEnv: (name: string) => {
        if (name === "KOORD_THREAD_ID") return "44444444444444444";
        if (name === "KOORD_DAEMON_URL") return "http://localhost:9999";
        return undefined;
      },
      safeFetch: async (url: string, opts: { body?: string }) => {
        sentUrl = url;
        sentBody = opts.body ?? "";
        return safeFetchOk();
      },
      getKoordConfig: () => ({ url: null }),
      stderr: () => {},
    };

    await SessionIdRegister.execute(input, deps);

    // URL matches original (SessionIdRegister.hook.js:78)
    expect(sentUrl).toBe("http://localhost:9999/register-session");

    // Body matches original (SessionIdRegister.hook.js:79)
    expect(JSON.parse(sentBody)).toEqual({
      sessionId: "my-session-uuid-here",
      threadId: "44444444444444444",
    });
  });

  test("skips silently when KOORD_THREAD_ID missing like original", async () => {
    // Original JS hook (SessionIdRegister.hook.js:65-69):
    //   if (!threadId) { stderr; exit; }
    const { SessionIdRegister } = await import(
      "@hooks/hooks/KoordDaemon/SessionIdRegister/SessionIdRegister.contract"
    );

    let fetchCalled = false;
    const input: SessionStartInput = { session_id: "my-session" };

    const deps = {
      getEnv: () => undefined, // No env vars set
      safeFetch: async () => {
        fetchCalled = true;
        return safeFetchOk();
      },
      getKoordConfig: () => ({ url: null }),
      stderr: () => {},
    };

    await SessionIdRegister.execute(input, deps);
    expect(fetchCalled).toBe(false); // Must not call daemon
  });

  test("strips trailing slashes from daemon URL like original", async () => {
    // Original JS hook (SessionIdRegister.hook.js:78):
    //   daemonUrl.replace(/\/+$/, "")
    const { SessionIdRegister } = await import(
      "@hooks/hooks/KoordDaemon/SessionIdRegister/SessionIdRegister.contract"
    );

    let sentUrl = "";
    const input: SessionStartInput = { session_id: "sess" };

    const deps = {
      getEnv: (name: string) => {
        if (name === "KOORD_THREAD_ID") return "55555555555555555";
        if (name === "KOORD_DAEMON_URL") return "http://localhost:9999///";
        return undefined;
      },
      safeFetch: async (url: string) => {
        sentUrl = url;
        return safeFetchOk();
      },
      getKoordConfig: () => ({ url: null }),
      stderr: () => {},
    };

    await SessionIdRegister.execute(input, deps);
    expect(sentUrl).toBe("http://localhost:9999/register-session");
  });
});
