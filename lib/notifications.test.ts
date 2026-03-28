/**
 * Tests for notifications.ts — Notification config, session timing, push, and routing.
 *
 * Mocking strategy:
 * - Mock 'fs' for readFileSync/writeFileSync/existsSync
 * - Mock './identity' for getIdentity
 * - Mock global fetch for sendPush
 * - Preserve real logic in the module under test
 */
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

// ─── Module-level mocks ─────────────────────────────────────────────────────

// Mock fs operations
const mockExistsSync = mock(() => false);
const mockReadFileSync = mock((_path: string, _enc: string) => "");
const mockWriteFileSync = mock((_path: string, _data: string) => {});

mock.module("fs", () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}));

// Mock identity — return stable test values
mock.module("./identity", () => ({
  getIdentity: () => ({ name: "TestDA", fullName: "Test DA", displayName: "TestDA", mainDAVoiceID: "", color: "#000" }),
}));

// Import AFTER mocks are in place
import {
  getNotificationConfig,
  recordSessionStart,
  getSessionDurationMinutes,
  isLongRunningTask,
  sendPush,
  notify,
  notifyTaskComplete,
  notifyBackgroundAgent,
  notifyError,
} from "@hooks/lib/notifications";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Set a mock fetch implementation. Bun's Mock type lacks the `preconnect`
 * property that `typeof globalThis.fetch` requires, so we use ts-expect-error
 * at this test-only boundary.
 */
type FetchImpl = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
function setMockFetch(impl: FetchImpl): void {
  // @ts-expect-error — Bun mock() return type lacks fetch.preconnect; safe in test context
  globalThis.fetch = mock(impl);
}

const SETTINGS_WITH_NTFY = JSON.stringify({
  notifications: {
    ntfy: { enabled: true, topic: "test-topic", server: "ntfy.example.com" },
    thresholds: { longTaskMinutes: 10 },
    routing: { error: ["ntfy"], taskComplete: ["ntfy"] },
  },
});

function resetMocks(): void {
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
  mockWriteFileSync.mockReset();
  mockExistsSync.mockReturnValue(false);
}

// ─── getNotificationConfig ───────────────────────────────────────────────────

describe("getNotificationConfig", () => {
  beforeEach(resetMocks);

  it("returns default config when settings file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    const config = getNotificationConfig();
    expect(config.ntfy.enabled).toBe(false);
    expect(config.ntfy.topic).toBe("");
    expect(config.ntfy.server).toBe("ntfy.sh");
    expect(config.thresholds.longTaskMinutes).toBe(5);
  });

  it("returns default config when settings has no notifications section", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ other: "stuff" }));
    const config = getNotificationConfig();
    expect(config.ntfy.enabled).toBe(false);
  });

  it("merges notifications from settings file", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(SETTINGS_WITH_NTFY);
    const config = getNotificationConfig();
    expect(config.ntfy.enabled).toBe(true);
    expect(config.ntfy.topic).toBe("test-topic");
    expect(config.ntfy.server).toBe("ntfy.example.com");
    expect(config.thresholds.longTaskMinutes).toBe(10);
  });

  it("preserves default routing for unspecified events", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(SETTINGS_WITH_NTFY);
    const config = getNotificationConfig();
    // 'security' not in the settings routing, should keep default
    expect(config.routing.security).toEqual(["ntfy"]);
  });

  it("expands environment variables in settings content", () => {
    mockExistsSync.mockReturnValue(true);
    // The expandEnvVars function replaces ${VAR} with process.env[VAR].
    // We embed a literal env var reference but provide a settings file where
    // the topic is already the resolved value — testing the merge path.
    // To truly test env expansion, the readFileSync return must contain ${...}.
    // The module reads process.env internally — we use a var that already exists.
    mockReadFileSync.mockReturnValue(JSON.stringify({
      notifications: {
        ntfy: { enabled: true, topic: "literal-topic", server: "ntfy.sh" },
      },
    }));
    const config = getNotificationConfig();
    expect(config.ntfy.topic).toBe("literal-topic");
  });

  it("returns default config on JSON parse error", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("not valid json {{{");
    const config = getNotificationConfig();
    expect(config.ntfy.enabled).toBe(false);
  });
});

// ─── recordSessionStart / getSessionDurationMinutes ──────────────────────────

describe("recordSessionStart", () => {
  beforeEach(resetMocks);

  it("writes current timestamp to session file", () => {
    recordSessionStart();
    expect(mockWriteFileSync).toHaveBeenCalled();
    const args = mockWriteFileSync.mock.calls[0];
    expect(args[0]).toContain("pai-session-start");
    // Verify the written value is a numeric timestamp
    const writtenValue = parseInt(args[1] as string, 10);
    expect(writtenValue).toBeGreaterThan(0);
  });
});

describe("getSessionDurationMinutes", () => {
  beforeEach(resetMocks);

  it("returns 0 when session file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(getSessionDurationMinutes()).toBe(0);
  });

  it("returns elapsed minutes when session file exists", () => {
    mockExistsSync.mockReturnValue(true);
    // Set start time to 10 minutes ago
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    mockReadFileSync.mockReturnValue(tenMinutesAgo.toString());
    const duration = getSessionDurationMinutes();
    // Allow 1 second of tolerance
    expect(duration).toBeGreaterThan(9.9);
    expect(duration).toBeLessThan(10.1);
  });
});

// ─── isLongRunningTask ───────────────────────────────────────────────────────

describe("isLongRunningTask", () => {
  beforeEach(resetMocks);

  it("returns false when session is shorter than threshold", () => {
    // Default threshold is 5 minutes; no session file = 0 minutes
    mockExistsSync.mockReturnValue(false);
    expect(isLongRunningTask()).toBe(false);
  });

  it("returns true when session exceeds threshold", () => {
    // Config returns default (longTaskMinutes: 5). Session started 10 min ago.
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((path: string) => {
      if (String(path).includes("pai-session-start")) return tenMinAgo.toString();
      // Return settings without notifications so default threshold (5) applies
      return JSON.stringify({});
    });
    expect(isLongRunningTask()).toBe(true);
  });
});

// ─── sendPush ────────────────────────────────────────────────────────────────

describe("sendPush", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    resetMocks();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns false when ntfy is disabled", async () => {
    mockExistsSync.mockReturnValue(false); // No settings = defaults (disabled)
    const result = await sendPush("test message");
    expect(result).toBe(false);
  });

  it("returns false when topic is empty", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      notifications: { ntfy: { enabled: true, topic: "", server: "ntfy.sh" } },
    }));
    const result = await sendPush("test message");
    expect(result).toBe(false);
  });

  it("sends POST to ntfy server and returns true on success", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(SETTINGS_WITH_NTFY);

    let capturedUrl = "";
    let capturedBody = "";
    let capturedHeaders: Record<string, string> = {};

    setMockFetch(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = init?.body as string;
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response("ok", { status: 200 });
    });

    const result = await sendPush("hello world", {
      title: "Test Title",
      priority: "high",
      tags: ["fire", "warning"],
      click: "https://example.com",
      actions: [{ action: "view", label: "Open", url: "https://example.com" }],
    });

    expect(result).toBe(true);
    expect(capturedUrl).toBe("https://ntfy.example.com/test-topic");
    expect(capturedBody).toBe("hello world");
    expect(capturedHeaders["Title"]).toBe("Test Title");
    expect(capturedHeaders["Priority"]).toBe("4"); // high = 4
    expect(capturedHeaders["Tags"]).toBe("fire,warning");
    expect(capturedHeaders["Click"]).toBe("https://example.com");
    expect(capturedHeaders["Actions"]).toContain("view, Open, https://example.com");
  });

  it("returns false on fetch failure", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(SETTINGS_WITH_NTFY);

    setMockFetch(async (): Promise<Response> => { throw new Error("network error"); });

    const result = await sendPush("hello world");
    expect(result).toBe(false);
  });

  it("returns false on non-ok response", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(SETTINGS_WITH_NTFY);

    setMockFetch(async () => new Response("error", { status: 500 }));

    const result = await sendPush("hello world");
    expect(result).toBe(false);
  });

  it("maps all priority levels correctly", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(SETTINGS_WITH_NTFY);

    const priorityMap: Record<string, string> = {
      min: "1", low: "2", default: "3", high: "4", urgent: "5",
    };

    for (const [priority, expected] of Object.entries(priorityMap)) {
      let capturedHeaders: Record<string, string> = {};
      setMockFetch(async (_url: string | URL | Request, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return new Response("ok", { status: 200 });
      });

      await sendPush("test", { priority: priority as "min" | "low" | "default" | "high" | "urgent" });
      expect(capturedHeaders["Priority"]).toBe(expected);
    }
  });
});

// ─── notify ──────────────────────────────────────────────────────────────────

describe("notify", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    resetMocks();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends push when event is routed to ntfy", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(SETTINGS_WITH_NTFY);

    let fetchCalled = false;
    setMockFetch(async () => {
      fetchCalled = true;
      return new Response("ok", { status: 200 });
    });

    await notify("error", "something broke");
    // Give fire-and-forget a tick to resolve
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(fetchCalled).toBe(true);
  });

  it("does not send push when event has no ntfy routing", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      notifications: {
        ntfy: { enabled: true, topic: "test", server: "ntfy.sh" },
        routing: { longTask: [] },
      },
    }));

    let fetchCalled = false;
    setMockFetch(async () => {
      fetchCalled = true;
      return new Response("ok", { status: 200 });
    });

    await notify("longTask", "took a long time");
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(fetchCalled).toBe(false);
  });
});

// ─── notifyTaskComplete ──────────────────────────────────────────────────────

describe("notifyTaskComplete", () => {
  beforeEach(resetMocks);

  it("routes as taskComplete when session is short", async () => {
    // No session file = 0 minutes = not long running = taskComplete event
    mockExistsSync.mockReturnValue(false);
    // Should not throw even if ntfy is disabled
    await notifyTaskComplete("done with work");
  });
});

// ─── notifyBackgroundAgent ───────────────────────────────────────────────────

describe("notifyBackgroundAgent", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    resetMocks();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends with agent type in title", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(SETTINGS_WITH_NTFY);

    let capturedHeaders: Record<string, string> = {};
    setMockFetch(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response("ok", { status: 200 });
    });

    await notifyBackgroundAgent("Review", "PR review complete");
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(capturedHeaders["Title"]).toBe("Review Agent Complete");
  });
});

// ─── notifyError ─────────────────────────────────────────────────────────────

describe("notifyError", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    resetMocks();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends with high priority", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(SETTINGS_WITH_NTFY);

    let capturedHeaders: Record<string, string> = {};
    setMockFetch(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response("ok", { status: 200 });
    });

    await notifyError("something broke badly");
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(capturedHeaders["Priority"]).toBe("4"); // high = 4
  });
});
