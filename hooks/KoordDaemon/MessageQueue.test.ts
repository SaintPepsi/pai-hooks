/**
 * Tests for MessageQueue hooks: MessageQueueServer and MessageQueueRelay.
 */

import { describe, expect, test } from "bun:test";
import type { SessionStartInput, ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { MessageQueueRelayDeps } from "@hooks/hooks/KoordDaemon/MessageQueueRelay/MessageQueueRelay.contract";
import { MessageQueueRelay } from "@hooks/hooks/KoordDaemon/MessageQueueRelay/MessageQueueRelay.contract";
import type { MessageQueueServerDeps } from "@hooks/hooks/KoordDaemon/MessageQueueServer/MessageQueueServer.contract";
import { MessageQueueServer } from "@hooks/hooks/KoordDaemon/MessageQueueServer/MessageQueueServer.contract";
import {
  getCursorFile,
  getMessagesDir,
  getPidFile,
  getPortFile,
  getQueueDir,
  MQ_WATCHER_MARKER,
} from "@hooks/hooks/KoordDaemon/shared";

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
    expect(result.ok && result.value).toEqual({});
  });

  test("skips when no session_id", async () => {
    const deps = makeDeps({
      getEnv: (name) => (name === "KOORD_DAEMON_URL" ? "http://localhost:9999" : undefined),
    });
    const result = await MessageQueueServer.execute({ session_id: "" }, deps);
    expect(result.ok && result.value).toEqual({});
  });

  test("skips if server already running (port file exists)", async () => {
    const deps = makeDeps({
      getEnv: (name) => (name === "KOORD_DAEMON_URL" ? "http://localhost:9999" : undefined),
      fileExists: () => true,
    });
    const result = await MessageQueueServer.execute(baseInput, deps);
    expect(result.ok && result.value).toEqual({});
  });

  test("spawns server and returns context when daemon URL configured", async () => {
    let spawnedArgs: string[] = [];
    const deps = makeDeps({
      getEnv: (name) => (name === "KOORD_DAEMON_URL" ? "http://localhost:9999" : undefined),
      spawnDetached: (_cmd, args) => {
        spawnedArgs = args;
        return { ok: true };
      },
    });

    const result = await MessageQueueServer.execute(baseInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const hso = result.value.hookSpecificOutput;
      if (hso && hso.hookEventName === "SessionStart") {
        expect(hso.additionalContext).toContain("Message Queue Active");
        expect(hso.additionalContext).toContain("test-session-mq");
        expect(hso.additionalContext).toContain("mq-watcher");
      } else {
        throw new Error("Expected SessionStart hookSpecificOutput");
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
      spawnDetached: () => {
        spawned = true;
        return { ok: true };
      },
    });

    const result = await MessageQueueServer.execute(baseInput, deps);
    expect(spawned).toBe(true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const hso = result.value.hookSpecificOutput;
      expect(hso && hso.hookEventName === "SessionStart" && hso.additionalContext).toBeTruthy();
    }
  });

  test("returns silent on spawn failure", async () => {
    const deps = makeDeps({
      getEnv: (name) => (name === "KOORD_DAEMON_URL" ? "http://localhost:9999" : undefined),
      spawnDetached: () => ({ ok: false }),
    });

    const result = await MessageQueueServer.execute(baseInput, deps);
    expect(result.ok && result.value).toEqual({});
  });
});

// ─── MessageQueueRelay ──────────────────────────────────────────────────────

describe("MessageQueueRelay", () => {
  function makeInput(
    overrides: Partial<ToolHookInput> & { command?: string; response?: string } = {},
  ): ToolHookInput {
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
      expect(result.value.continue).toBe(true);
      expect(result.value.hookSpecificOutput).toBeUndefined();
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
      const hso = result.value.hookSpecificOutput;
      if (hso && hso.hookEventName === "PostToolUse") {
        expect(hso.additionalContext).toContain("New Message Received");
        expect(hso.additionalContext).toContain("Deploy to staging please");
        expect(hso.additionalContext).toContain("from koord-daemon");
        expect(hso.additionalContext).toContain("--session test-session-abc");
      } else {
        throw new Error("Expected PostToolUse hookSpecificOutput");
      }
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
      const hso = result.value.hookSpecificOutput;
      if (hso && hso.hookEventName === "PostToolUse") {
        expect(hso.additionalContext).toContain("Hello from the outside");
        expect(hso.additionalContext).toContain("respawn the watcher");
      } else {
        throw new Error("Expected PostToolUse hookSpecificOutput");
      }
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
      const hso = result.value.hookSpecificOutput;
      if (hso && hso.hookEventName === "PostToolUse") {
        expect(hso.additionalContext).toContain("Watcher Timeout");
        expect(hso.additionalContext).toContain("--session sess123");
      } else {
        throw new Error("Expected PostToolUse hookSpecificOutput");
      }
    }
  });

  test("handles watcher with no response at all", () => {
    const input = makeInput({
      command: "bun scripts/mq-watcher.ts --session sess123",
    });

    const result = MessageQueueRelay.execute(input, defaultDeps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const hso = result.value.hookSpecificOutput;
      if (hso && hso.hookEventName === "PostToolUse") {
        expect(hso.additionalContext).toContain("Watcher Timeout");
      } else {
        throw new Error("Expected PostToolUse hookSpecificOutput");
      }
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
      const hso = result.value.hookSpecificOutput;
      if (hso && hso.hookEventName === "PostToolUse") {
        expect(hso.additionalContext).toContain("--session my-unique-session");
      } else {
        throw new Error("Expected PostToolUse hookSpecificOutput");
      }
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
      const hso = result.value.hookSpecificOutput;
      if (hso && hso.hookEventName === "PostToolUse") {
        expect(hso.additionalContext).toContain("IMPORTANT");
        expect(hso.additionalContext).toContain("respawn the watcher");
      } else {
        throw new Error("Expected PostToolUse hookSpecificOutput");
      }
    }
  });
});
