/**
 * Tests for MessageQueue hooks: MessageQueueServer and MessageQueueRelay.
 */

import { describe, test, expect } from "bun:test";
import { ok } from "@hooks/core/result";
import {
  getQueueDir,
  getMessagesDir,
  getPortFile,
  getPidFile,
  getCursorFile,
  MQ_WATCHER_MARKER,
} from "@hooks/hooks/KoordDaemon/shared";
import { MessageQueueServer } from "@hooks/hooks/KoordDaemon/MessageQueueServer/MessageQueueServer.contract";
import type { MessageQueueServerDeps } from "@hooks/hooks/KoordDaemon/MessageQueueServer/MessageQueueServer.contract";
import { MessageQueueRelay } from "@hooks/hooks/KoordDaemon/MessageQueueRelay/MessageQueueRelay.contract";
import type { MessageQueueRelayDeps } from "@hooks/hooks/KoordDaemon/MessageQueueRelay/MessageQueueRelay.contract";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";

// ─── Shared Path Helpers ────────────────────────────────────────────────────

describe("MessageQueue shared paths", () => {
  test("getQueueDir returns correct path", () => {
    expect(getQueueDir("abc123")).toBe("/tmp/pai-mq/abc123");
  });

  test("getMessagesDir returns correct path", () => {
    expect(getMessagesDir("abc123")).toBe("/tmp/pai-mq/abc123/messages");
  });

  test("getPortFile returns correct path", () => {
    expect(getPortFile("abc123")).toBe("/tmp/pai-mq/abc123/port");
  });

  test("getPidFile returns correct path", () => {
    expect(getPidFile("abc123")).toBe("/tmp/pai-mq/abc123/pid");
  });

  test("getCursorFile returns correct path", () => {
    expect(getCursorFile("abc123")).toBe("/tmp/pai-mq/abc123/cursor");
  });

  test("MQ_WATCHER_MARKER is defined", () => {
    expect(MQ_WATCHER_MARKER).toBe("mq-watcher");
  });
});

// ─── MessageQueueServer ─────────────────────────────────────────────────────

describe("MessageQueueServer", () => {
  const baseInput: SessionStartInput = { session_id: "test-session-mq" };

  function makeDeps(overrides: Partial<MessageQueueServerDeps> = {}): MessageQueueServerDeps {
    return {
      getEnv: () => undefined,
      getKoordConfig: () => ({ url: null }),
      spawnDetached: () => ({ ok: true }),
      fileExists: () => false,
      stderr: () => {},
      getScriptPath: () => "/fake/scripts/mq-server.ts",
      ...overrides,
    };
  }

  test("accepts all SessionStart inputs", () => {
    expect(MessageQueueServer.accepts(baseInput)).toBe(true);
  });

  test("skips when no daemon URL configured", async () => {
    const deps = makeDeps();
    const result = await MessageQueueServer.execute(baseInput, deps);
    expect(result.ok && result.value.type).toBe("silent");
  });

  test("skips when no session_id", async () => {
    const deps = makeDeps({
      getEnv: (name) => name === "KOORD_DAEMON_URL" ? "http://localhost:9999" : undefined,
    });
    const result = await MessageQueueServer.execute({ session_id: "" }, deps);
    expect(result.ok && result.value.type).toBe("silent");
  });

  test("skips if server already running (port file exists)", async () => {
    const deps = makeDeps({
      getEnv: (name) => name === "KOORD_DAEMON_URL" ? "http://localhost:9999" : undefined,
      fileExists: () => true,
    });
    const result = await MessageQueueServer.execute(baseInput, deps);
    expect(result.ok && result.value.type).toBe("silent");
  });

  test("spawns server and returns context when daemon URL configured", async () => {
    let spawnedArgs: string[] = [];
    const deps = makeDeps({
      getEnv: (name) => name === "KOORD_DAEMON_URL" ? "http://localhost:9999" : undefined,
      spawnDetached: (_cmd, args) => {
        spawnedArgs = args;
        return { ok: true };
      },
    });

    const result = await MessageQueueServer.execute(baseInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("context");
      if (result.value.type === "context") {
        expect(result.value.content).toContain("Message Queue Active");
        expect(result.value.content).toContain("test-session-mq");
        expect(result.value.content).toContain("mq-watcher");
      }
    }

    expect(spawnedArgs).toContain("--session");
    expect(spawnedArgs).toContain("test-session-mq");
  });

  test("uses settings.json fallback for daemon URL", async () => {
    let spawned = false;
    const deps = makeDeps({
      getEnv: () => undefined,
      getKoordConfig: () => ({ url: "http://localhost:7777" }),
      spawnDetached: () => { spawned = true; return { ok: true }; },
    });

    const result = await MessageQueueServer.execute(baseInput, deps);
    expect(spawned).toBe(true);
    expect(result.ok && result.value.type).toBe("context");
  });

  test("returns silent on spawn failure", async () => {
    const deps = makeDeps({
      getEnv: (name) => name === "KOORD_DAEMON_URL" ? "http://localhost:9999" : undefined,
      spawnDetached: () => ({ ok: false }),
    });

    const result = await MessageQueueServer.execute(baseInput, deps);
    expect(result.ok && result.value.type).toBe("silent");
  });
});

// ─── MessageQueueRelay ──────────────────────────────────────────────────────

describe("MessageQueueRelay", () => {
  function makeInput(overrides: Partial<ToolHookInput> & { command?: string; response?: string } = {}): ToolHookInput {
    return {
      session_id: "test-session",
      tool_name: overrides.tool_name ?? "Bash",
      tool_input: {
        command: overrides.command ?? "echo hello",
      },
      tool_response: overrides.response,
    };
  }

  const defaultDeps: MessageQueueRelayDeps = { stderr: () => {} };

  test("accepts only Bash tool", () => {
    expect(MessageQueueRelay.accepts(makeInput())).toBe(true);
    expect(MessageQueueRelay.accepts(makeInput({ tool_name: "Agent" }))).toBe(false);
    expect(MessageQueueRelay.accepts(makeInput({ tool_name: "Read" }))).toBe(false);
  });

  test("passes through non-watcher Bash commands", () => {
    const result = MessageQueueRelay.execute(makeInput({ command: "ls -la" }), defaultDeps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
      expect(result.value.additionalContext).toBeUndefined();
    }
  });

  test("detects mq-watcher command and relays message", () => {
    const input = makeInput({
      command: "bun scripts/mq-watcher.ts --session test-session-abc",
      response: JSON.stringify({ from: "koord-daemon", body: "Deploy to staging please" }),
    });

    const result = MessageQueueRelay.execute(input, defaultDeps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
      expect(result.value.additionalContext).toContain("New Message Received");
      expect(result.value.additionalContext).toContain("Deploy to staging please");
      expect(result.value.additionalContext).toContain("from koord-daemon");
      expect(result.value.additionalContext).toContain("--session test-session-abc");
    }
  });

  test("handles plain text watcher output", () => {
    const input = makeInput({
      command: "bun scripts/mq-watcher.ts --session sess123",
      response: "Hello from the outside",
    });

    const result = MessageQueueRelay.execute(input, defaultDeps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.additionalContext).toContain("Hello from the outside");
      expect(result.value.additionalContext).toContain("respawn the watcher");
    }
  });

  test("handles watcher timeout (empty output)", () => {
    const input = makeInput({
      command: "bun scripts/mq-watcher.ts --session sess123",
      response: "",
    });

    const result = MessageQueueRelay.execute(input, defaultDeps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.additionalContext).toContain("Watcher Timeout");
      expect(result.value.additionalContext).toContain("--session sess123");
    }
  });

  test("handles watcher with no response at all", () => {
    const input = makeInput({
      command: "bun scripts/mq-watcher.ts --session sess123",
    });

    const result = MessageQueueRelay.execute(input, defaultDeps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.additionalContext).toContain("Watcher Timeout");
    }
  });

  test("extracts session ID from command for respawn directive", () => {
    const input = makeInput({
      command: "bun scripts/mq-watcher.ts --session my-unique-session",
      response: JSON.stringify({ body: "test" }),
    });

    const result = MessageQueueRelay.execute(input, defaultDeps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.additionalContext).toContain("--session my-unique-session");
    }
  });

  test("includes respawn directive in message relay", () => {
    const input = makeInput({
      command: "bun scripts/mq-watcher.ts --session sess123",
      response: JSON.stringify({ body: "new task" }),
    });

    const result = MessageQueueRelay.execute(input, defaultDeps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.additionalContext).toContain("IMPORTANT");
      expect(result.value.additionalContext).toContain("respawn the watcher");
    }
  });
});
