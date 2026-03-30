/**
 * Tests for KoordDaemon hooks: shared helpers, SessionIdRegister,
 * AgentPrepromptInjector, AgentSpawnTracker, AgentCompleteTracker.
 */

import { describe, expect, test } from "bun:test";
import { fileNotFound } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import type { SessionStartInput, ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { SessionIdRegisterDeps } from "@hooks/hooks/KoordDaemon/SessionIdRegister/SessionIdRegister.contract";
import { SessionIdRegister } from "@hooks/hooks/KoordDaemon/SessionIdRegister/SessionIdRegister.contract";
import {
  defaultReadFileOrNull,
  extractAgentName,
  extractTask,
  extractThreadId,
  extractThreadIdFromOutput,
  readKoordConfig,
} from "@hooks/hooks/KoordDaemon/shared";

// ─── Shared Helpers ──────────────────────────────────────────────────────────

describe("KoordDaemon shared", () => {
  describe("readKoordConfig", () => {
    test("returns config from valid settings.json", () => {
      const settings = JSON.stringify({
        hookConfig: {
          koordDaemon: {
            url: "http://localhost:9999",
            prepromptPath: "/path/to/worker.md",
          },
        },
      });
      const config = readKoordConfig(() => settings);
      expect(config.url).toBe("http://localhost:9999");
      expect(config.prepromptPath).toBe("/path/to/worker.md");
    });

    test("returns nulls when file not found", () => {
      const config = readKoordConfig(() => null);
      expect(config.url).toBeNull();
      expect(config.prepromptPath).toBeNull();
    });

    test("returns nulls when hookConfig missing", () => {
      const config = readKoordConfig(() => JSON.stringify({}));
      expect(config.url).toBeNull();
      expect(config.prepromptPath).toBeNull();
    });

    test("returns nulls on invalid JSON", () => {
      const config = readKoordConfig(() => "not json{");
      expect(config.url).toBeNull();
      expect(config.prepromptPath).toBeNull();
    });
  });

  describe("extractThreadId", () => {
    test("extracts from explicit thread_id field", () => {
      expect(extractThreadId({ thread_id: "12345678901234567" })).toBe("12345678901234567");
    });

    test("extracts from prompt text", () => {
      expect(extractThreadId({ prompt: 'thread_id: "12345678901234567"' })).toBe(
        "12345678901234567",
      );
    });

    test("returns null when no thread_id found", () => {
      expect(extractThreadId({ prompt: "no ids here" })).toBeNull();
    });

    test("rejects non-snowflake IDs", () => {
      expect(extractThreadId({ thread_id: "123" })).toBeNull();
    });
  });

  describe("extractThreadIdFromOutput", () => {
    test("extracts from top-level thread_id", () => {
      expect(extractThreadIdFromOutput({ thread_id: "12345678901234567" })).toBe(
        "12345678901234567",
      );
    });

    test("extracts from tool_output text", () => {
      expect(
        extractThreadIdFromOutput({
          tool_output: 'Completed work on thread_id="99887766554433221"',
        }),
      ).toBe("99887766554433221");
    });

    test("does NOT extract from tool_input", () => {
      expect(
        extractThreadIdFromOutput({
          tool_input: { thread_id: "12345678901234567" },
        }),
      ).toBeNull();
    });

    test("returns null when no thread_id found", () => {
      expect(extractThreadIdFromOutput({})).toBeNull();
    });
  });

  describe("extractAgentName", () => {
    test("extracts from name field", () => {
      expect(extractAgentName({ name: "worker-1" })).toBe("worker-1");
    });

    test("extracts from prompt text", () => {
      expect(extractAgentName({ prompt: 'agent_name="research-bot"' })).toBe("research-bot");
    });

    test("returns null when not found", () => {
      expect(extractAgentName({})).toBeNull();
    });
  });

  describe("extractTask", () => {
    test("extracts from task_description field", () => {
      expect(extractTask({ task_description: "Research API patterns" })).toBe(
        "Research API patterns",
      );
    });

    test("uses first line of prompt as fallback", () => {
      expect(extractTask({ prompt: "Build the component\nWith tests" })).toBe(
        "Build the component",
      );
    });

    test("truncates to 200 chars", () => {
      const long = "x".repeat(300);
      expect(extractTask({ task_description: long })!.length).toBe(200);
    });

    test("returns null when not found", () => {
      expect(extractTask({})).toBeNull();
    });
  });

  describe("defaultReadFileOrNull", () => {
    test("returns file content for an existing file", () => {
      const tmpPath = `/tmp/pai-test-readornull-${Date.now()}.txt`;
      require("fs").writeFileSync(tmpPath, "hello");
      const result = defaultReadFileOrNull(tmpPath);
      expect(result).toBe("hello");
      require("fs").unlinkSync(tmpPath);
    });

    test("returns null for a missing file", () => {
      const result = defaultReadFileOrNull("/tmp/pai-nonexistent-file-xyz.json");
      expect(result).toBeNull();
    });
  });
});

// ─── SessionIdRegister ───────────────────────────────────────────────────────

describe("SessionIdRegister", () => {
  const baseInput: SessionStartInput = { session_id: "test-session-abc123" };

  function makeDeps(overrides: Partial<SessionIdRegisterDeps> = {}): SessionIdRegisterDeps {
    return {
      getEnv: () => undefined,
      safeFetch: async () => ok({ status: 200, body: "", headers: {} }),
      getKoordConfig: () => ({ url: null }),
      stderr: () => {},
      ...overrides,
    };
  }

  test("accepts all SessionStart inputs", () => {
    expect(SessionIdRegister.accepts(baseInput)).toBe(true);
  });

  test("skips when no KOORD_THREAD_ID env var", async () => {
    const deps = makeDeps({ getEnv: () => undefined });
    const result = await SessionIdRegister.execute(baseInput, deps);
    expect(result.ok && result.value.type).toBe("silent");
  });

  test("uses KOORD_DAEMON_URL env var for daemon URL", async () => {
    let fetchedUrl = "";
    const deps = makeDeps({
      getEnv: (name) => {
        if (name === "KOORD_THREAD_ID") return "12345678901234567";
        if (name === "KOORD_DAEMON_URL") return "http://localhost:8888";
        return undefined;
      },
      safeFetch: async (url) => {
        fetchedUrl = url;
        return ok({ status: 200, body: "", headers: {} });
      },
    });

    await SessionIdRegister.execute(baseInput, deps);
    expect(fetchedUrl).toBe("http://localhost:8888/register-session");
  });

  test("falls back to settings.json config for daemon URL", async () => {
    let fetchedUrl = "";
    const deps = makeDeps({
      getEnv: (name) => {
        if (name === "KOORD_THREAD_ID") return "12345678901234567";
        return undefined; // No KOORD_DAEMON_URL
      },
      getKoordConfig: () => ({ url: "http://localhost:7777" }),
      safeFetch: async (url) => {
        fetchedUrl = url;
        return ok({ status: 200, body: "", headers: {} });
      },
    });

    await SessionIdRegister.execute(baseInput, deps);
    expect(fetchedUrl).toBe("http://localhost:7777/register-session");
  });

  test("skips when no daemon URL available", async () => {
    const deps = makeDeps({
      getEnv: (name) => {
        if (name === "KOORD_THREAD_ID") return "12345678901234567";
        return undefined;
      },
      getKoordConfig: () => ({ url: null }),
    });

    const result = await SessionIdRegister.execute(baseInput, deps);
    expect(result.ok && result.value.type).toBe("silent");
  });

  test("sends correct JSON body to /register-session", async () => {
    let sentBody = "";
    const deps = makeDeps({
      getEnv: (name) => {
        if (name === "KOORD_THREAD_ID") return "12345678901234567";
        if (name === "KOORD_DAEMON_URL") return "http://localhost:9999";
        return undefined;
      },
      safeFetch: async (_url, opts) => {
        sentBody = opts.body ?? "";
        return ok({ status: 200, body: "", headers: {} });
      },
    });

    await SessionIdRegister.execute(baseInput, deps);
    const parsed = JSON.parse(sentBody);
    expect(parsed.sessionId).toBe("test-session-abc123");
    expect(parsed.threadId).toBe("12345678901234567");
  });

  test("fails silently on fetch error", async () => {
    const deps = makeDeps({
      getEnv: (name) => {
        if (name === "KOORD_THREAD_ID") return "12345678901234567";
        if (name === "KOORD_DAEMON_URL") return "http://localhost:9999";
        return undefined;
      },
      safeFetch: async () => err(fileNotFound("test")),
    });

    const result = await SessionIdRegister.execute(baseInput, deps);
    expect(result.ok && result.value.type).toBe("silent");
  });
});

// ─── AgentPrepromptInjector ──────────────────────────────────────────────────
// Tests imported after agent creates the contract

describe("AgentPrepromptInjector", () => {
  // Defer import to avoid failing if agent hasn't written the file yet during development.
  // In CI, all files exist. This pattern matches hooks/AgentLifecycle tests.

  const makeToolInput = (overrides: Record<string, unknown> = {}): ToolHookInput => ({
    session_id: "test-session",
    tool_name: "Agent",
    tool_input: {
      run_in_background: true,
      prompt: "Do some work",
      name: "worker-1",
      thread_id: "12345678901234567",
      ...overrides,
    },
  });

  test("accepts only Agent tool", async () => {
    const { AgentPrepromptInjector } = await import(
      "@hooks/hooks/KoordDaemon/AgentPrepromptInjector/AgentPrepromptInjector.contract"
    );
    expect(AgentPrepromptInjector.accepts(makeToolInput())).toBe(true);
    expect(AgentPrepromptInjector.accepts({ ...makeToolInput(), tool_name: "Bash" })).toBe(false);
  });

  test("skips non-background agents", async () => {
    const { AgentPrepromptInjector } = await import(
      "@hooks/hooks/KoordDaemon/AgentPrepromptInjector/AgentPrepromptInjector.contract"
    );
    const input = makeToolInput({ run_in_background: false });
    const deps = {
      fileExists: () => false,
      readFile: () => err(fileNotFound("test")),
      getKoordConfig: () => ({ prepromptPath: null }),
      getCwd: () => "/tmp",
      stderr: () => {},
    };
    const result = AgentPrepromptInjector.execute(input, deps);
    expect(result.ok && result.value.type).toBe("continue");
  });

  test("injects preprompt into prompt when template found", async () => {
    const { AgentPrepromptInjector } = await import(
      "@hooks/hooks/KoordDaemon/AgentPrepromptInjector/AgentPrepromptInjector.contract"
    );
    const input = makeToolInput();
    const deps = {
      fileExists: () => true,
      readFile: () => ok("Hello {{agent_name}}, thread {{thread_id}}, task: {{task_description}}"),
      getKoordConfig: () => ({ prepromptPath: "/custom/worker.md" }),
      getCwd: () => "/tmp",
      stderr: () => {},
    };
    const result = AgentPrepromptInjector.execute(input, deps);
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === "updatedInput") {
      const prompt = result.value.updatedInput.prompt as string;
      expect(prompt).toContain("Do some work");
      expect(prompt).toContain("Hello worker-1");
      expect(prompt).toContain("thread 12345678901234567");
      expect(prompt).toContain("task: Do some work");
    } else {
      throw new Error("Expected updatedInput output");
    }
  });

  test("falls back to cwd path when no config", async () => {
    const { AgentPrepromptInjector } = await import(
      "@hooks/hooks/KoordDaemon/AgentPrepromptInjector/AgentPrepromptInjector.contract"
    );
    let readPath = "";
    const input = makeToolInput();
    const deps = {
      fileExists: (p: string) => {
        readPath = p;
        return false;
      },
      readFile: () => err(fileNotFound("test")),
      getKoordConfig: () => ({ prepromptPath: null }),
      getCwd: () => "/my/project",
      stderr: () => {},
    };
    AgentPrepromptInjector.execute(input, deps);
    expect(readPath).toBe("/my/project/src/prompts/worker.md");
  });
});

// ─── AgentSpawnTracker ───────────────────────────────────────────────────────

describe("AgentSpawnTracker", () => {
  const makeToolInput = (overrides: Record<string, unknown> = {}): ToolHookInput => ({
    session_id: "test-session",
    tool_name: "Agent",
    tool_input: {
      run_in_background: true,
      name: "research-bot",
      thread_id: "12345678901234567",
      prompt: "Research something",
      ...overrides,
    },
  });

  const makeDeps = (overrides: Record<string, unknown> = {}) => ({
    getEnv: (name: string) => {
      if (name === "KOORD_DAEMON_URL") return "http://localhost:9999";
      return undefined;
    },
    safeFetch: async () => ok({ status: 200, body: "", headers: {} }),
    getKoordConfig: () => ({ url: null }),
    stderr: () => {},
    ...overrides,
  });

  test("accepts only Agent tool", async () => {
    const { AgentSpawnTracker } = await import(
      "@hooks/hooks/KoordDaemon/AgentSpawnTracker/AgentSpawnTracker.contract"
    );
    expect(AgentSpawnTracker.accepts(makeToolInput())).toBe(true);
    expect(AgentSpawnTracker.accepts({ ...makeToolInput(), tool_name: "Bash" })).toBe(false);
  });

  test("skips non-background agents", async () => {
    const { AgentSpawnTracker } = await import(
      "@hooks/hooks/KoordDaemon/AgentSpawnTracker/AgentSpawnTracker.contract"
    );
    const input = makeToolInput({ run_in_background: false });
    const result = await AgentSpawnTracker.execute(input, makeDeps());
    expect(result.ok && result.value.type).toBe("continue");
  });

  test("skips when no thread_id", async () => {
    const { AgentSpawnTracker } = await import(
      "@hooks/hooks/KoordDaemon/AgentSpawnTracker/AgentSpawnTracker.contract"
    );
    const input = makeToolInput({ thread_id: undefined, prompt: "no ids" });
    const result = await AgentSpawnTracker.execute(input, makeDeps());
    expect(result.ok && result.value.type).toBe("continue");
  });

  test("posts to daemon /spawn with correct body", async () => {
    const { AgentSpawnTracker } = await import(
      "@hooks/hooks/KoordDaemon/AgentSpawnTracker/AgentSpawnTracker.contract"
    );
    let sentUrl = "";
    let sentBody = "";
    const deps = makeDeps({
      safeFetch: async (url: string, opts: { body?: string }) => {
        sentUrl = url;
        sentBody = opts.body ?? "";
        return ok({ status: 200, body: "", headers: {} });
      },
    });
    await AgentSpawnTracker.execute(makeToolInput(), deps);
    expect(sentUrl).toBe("http://localhost:9999/spawn");
    const parsed = JSON.parse(sentBody);
    expect(parsed.thread_id).toBe("12345678901234567");
    expect(parsed.agent_name).toBe("research-bot");
  });
});

// ─── AgentCompleteTracker ────────────────────────────────────────────────────

describe("AgentCompleteTracker", () => {
  const makeToolInput = (overrides: Record<string, unknown> = {}): ToolHookInput => ({
    session_id: "test-session",
    tool_name: "Agent",
    tool_input: {},
    tool_response: 'Completed work on thread_id="12345678901234567"',
    ...overrides,
  });

  const makeDeps = (overrides: Record<string, unknown> = {}) => ({
    getEnv: (name: string) => {
      if (name === "KOORD_DAEMON_URL") return "http://localhost:9999";
      return undefined;
    },
    safeFetch: async () => ok({ status: 200, body: "", headers: {} }),
    getKoordConfig: () => ({ url: null }),
    stderr: () => {},
    ...overrides,
  });

  test("accepts only Agent tool", async () => {
    const { AgentCompleteTracker } = await import(
      "@hooks/hooks/KoordDaemon/AgentCompleteTracker/AgentCompleteTracker.contract"
    );
    expect(AgentCompleteTracker.accepts(makeToolInput())).toBe(true);
    expect(AgentCompleteTracker.accepts({ ...makeToolInput(), tool_name: "Bash" })).toBe(false);
  });

  test("skips background spawn events", async () => {
    const { AgentCompleteTracker } = await import(
      "@hooks/hooks/KoordDaemon/AgentCompleteTracker/AgentCompleteTracker.contract"
    );
    const input = makeToolInput({ tool_input: { run_in_background: true } });
    const result = await AgentCompleteTracker.execute(input, makeDeps());
    expect(result.ok && result.value.type).toBe("continue");
  });

  test("extracts thread_id from tool_output", async () => {
    const { AgentCompleteTracker } = await import(
      "@hooks/hooks/KoordDaemon/AgentCompleteTracker/AgentCompleteTracker.contract"
    );
    let sentUrl = "";
    let sentBody = "";
    const input: ToolHookInput = {
      session_id: "test-session",
      tool_name: "Agent",
      tool_input: {},
      tool_response: 'Done with thread_id="99887766554433221"',
    };
    const deps = makeDeps({
      safeFetch: async (url: string, opts: { body?: string }) => {
        sentUrl = url;
        sentBody = opts.body ?? "";
        return ok({ status: 200, body: "", headers: {} });
      },
    });
    await AgentCompleteTracker.execute(input, deps);
    expect(sentUrl).toBe("http://localhost:9999/complete");
    const parsed = JSON.parse(sentBody);
    expect(parsed.thread_id).toBe("99887766554433221");
  });

  test("skips when no thread_id in output", async () => {
    const { AgentCompleteTracker } = await import(
      "@hooks/hooks/KoordDaemon/AgentCompleteTracker/AgentCompleteTracker.contract"
    );
    const input: ToolHookInput = {
      session_id: "test-session",
      tool_name: "Agent",
      tool_input: {},
      tool_response: "Completed some generic task",
    };
    const result = await AgentCompleteTracker.execute(input, makeDeps());
    expect(result.ok && result.value.type).toBe("continue");
  });
});
