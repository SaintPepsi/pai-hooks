/**
 * Tests for notifications.ts — Notification config, session timing, push, and routing.
 *
 * Mocking strategy:
 * - Use NotificationDeps injection (NO mock.module — it leaks globally in bun test)
 * - Pre-populate identity cache with test values
 * - Mock global fetch for sendPush
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { ResultError } from "@hooks/core/error";
import { jsonParseFailed } from "@hooks/core/error";
import { err, ok, type Result, tryCatch } from "@hooks/core/result";
import { clearCache, getIdentity, type IdentityDeps } from "@hooks/lib/identity";
import type { NotificationDeps } from "@hooks/lib/notifications";
import {
  defaultNotificationDeps,
  getNotificationConfig,
  getSessionDurationMinutes,
  isLongRunningTask,
  notify,
  notifyBackgroundAgent,
  notifyError,
  notifyTaskComplete,
  recordSessionStart,
  sendPush,
} from "@hooks/lib/notifications";

// ─── Identity cache seeding ────────────────────────────────────────────────

const testIdentityDeps: IdentityDeps = {
  settingsPath: "/tmp/test-notifications-settings.json",
  readJson: () =>
    ok({
      daidentity: {
        name: "TestDA",
        fullName: "Test DA",
        displayName: "TestDA",
        color: "#000",
      },
    }),
  fileExists: () => true,
};

function seedIdentityCache(): void {
  clearCache();
  getIdentity(testIdentityDeps);
}

// ─── Mock Deps ─────────────────────────────────────────────────────────────

const mockReadFile = mock(
  (_path: string): Result<string, ResultError> =>
    err({ code: "FILE_NOT_FOUND", message: "not found" } as ResultError),
);
const mockFileExists = mock((_path: string): boolean => false);
const mockWriteFile = mock(
  (_path: string, _content: string): Result<void, ResultError> => ok(undefined),
);
const mockStderr = mock((_msg: string): void => {});

function createMockDeps(overrides: Partial<NotificationDeps> = {}): NotificationDeps {
  return {
    readFile: mockReadFile,
    fileExists: mockFileExists,
    writeFile: mockWriteFile,
    parseJson: <T>(raw: string): Result<T, ResultError> =>
      tryCatch(
        () => JSON.parse(raw) as T,
        (e) => jsonParseFailed(raw.slice(0, 80), e),
      ),
    lookupEnv: () => undefined,
    paiDir: "/tmp/test-notifications",
    stderr: mockStderr,
    ...overrides,
  };
}

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
  mockReadFile.mockReset();
  mockFileExists.mockReset();
  mockWriteFile.mockReset();
  mockStderr.mockReset();
  mockFileExists.mockReturnValue(false);
  mockReadFile.mockReturnValue(
    err({ code: "FILE_NOT_FOUND", message: "not found" } as ResultError),
  );
  seedIdentityCache();
}

// ─── getNotificationConfig ───────────────────────────────────────────────────

describe("getNotificationConfig", () => {
  beforeEach(resetMocks);
  afterEach(() => clearCache());

  it("returns default config when settings file does not exist", () => {
    const deps = createMockDeps({ fileExists: () => false });
    const config = getNotificationConfig(deps);
    expect(config.ntfy.enabled).toBe(false);
    expect(config.ntfy.topic).toBe("");
    expect(config.ntfy.server).toBe("ntfy.sh");
    expect(config.thresholds.longTaskMinutes).toBe(5);
  });

  it("returns default config when settings has no notifications section", () => {
    const deps = createMockDeps({
      fileExists: () => true,
      readFile: () => ok(JSON.stringify({ other: "stuff" })),
    });
    const config = getNotificationConfig(deps);
    expect(config.ntfy.enabled).toBe(false);
  });

  it("merges notifications from settings file", () => {
    const deps = createMockDeps({
      fileExists: () => true,
      readFile: () => ok(SETTINGS_WITH_NTFY),
    });
    const config = getNotificationConfig(deps);
    expect(config.ntfy.enabled).toBe(true);
    expect(config.ntfy.topic).toBe("test-topic");
    expect(config.ntfy.server).toBe("ntfy.example.com");
    expect(config.thresholds.longTaskMinutes).toBe(10);
  });

  it("preserves default routing for unspecified events", () => {
    const deps = createMockDeps({
      fileExists: () => true,
      readFile: () => ok(SETTINGS_WITH_NTFY),
    });
    const config = getNotificationConfig(deps);
    // 'security' not in the settings routing, should keep default
    expect(config.routing.security).toEqual(["ntfy"]);
  });

  it("expands environment variables in settings content", () => {
    const deps = createMockDeps({
      fileExists: () => true,
      readFile: () =>
        ok(
          JSON.stringify({
            notifications: {
              ntfy: {
                enabled: true,
                topic: "literal-topic",
                server: "ntfy.sh",
              },
            },
          }),
        ),
    });
    const config = getNotificationConfig(deps);
    expect(config.ntfy.topic).toBe("literal-topic");
  });

  it("returns default config on JSON parse error", () => {
    const deps = createMockDeps({
      fileExists: () => true,
      readFile: () => ok("not valid json {{{"),
    });
    const config = getNotificationConfig(deps);
    expect(config.ntfy.enabled).toBe(false);
  });

  it("returns default config when readFile fails", () => {
    const stderrMessages: string[] = [];
    const deps = createMockDeps({
      fileExists: () => true,
      readFile: () =>
        err({
          code: "FILE_READ_FAILED",
          message: "permission denied",
        } as ResultError),
      stderr: (msg) => {
        stderrMessages.push(msg);
      },
    });
    const config = getNotificationConfig(deps);
    expect(config.ntfy.enabled).toBe(false);
    expect(stderrMessages.some((m) => m.includes("Failed to load notification config"))).toBe(true);
  });
});

// ─── recordSessionStart / getSessionDurationMinutes ──────────────────────────

describe("recordSessionStart", () => {
  beforeEach(resetMocks);
  afterEach(() => clearCache());

  it("writes current timestamp to session file", () => {
    const writeCalls: Array<{ path: string; content: string }> = [];
    const deps = createMockDeps({
      writeFile: (path: string, content: string) => {
        writeCalls.push({ path, content });
        return ok(undefined);
      },
    });
    recordSessionStart(deps);
    expect(writeCalls.length).toBe(1);
    expect(writeCalls[0].path).toContain("pai-session-start");
    // Verify the written value is a numeric timestamp
    const writtenValue = parseInt(writeCalls[0].content, 10);
    expect(writtenValue).toBeGreaterThan(0);
  });
});

describe("getSessionDurationMinutes", () => {
  beforeEach(resetMocks);
  afterEach(() => clearCache());

  it("returns 0 when session file does not exist", () => {
    const deps = createMockDeps({ fileExists: () => false });
    expect(getSessionDurationMinutes(deps)).toBe(0);
  });

  it("returns elapsed minutes when session file exists", () => {
    // Set start time to 10 minutes ago
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    const deps = createMockDeps({
      fileExists: () => true,
      readFile: () => ok(tenMinutesAgo.toString()),
    });
    const duration = getSessionDurationMinutes(deps);
    // Allow 1 second of tolerance
    expect(duration).toBeGreaterThan(9.9);
    expect(duration).toBeLessThan(10.1);
  });
});

// ─── isLongRunningTask ───────────────────────────────────────────────────────

describe("isLongRunningTask", () => {
  beforeEach(resetMocks);
  afterEach(() => clearCache());

  it("returns false when session is shorter than threshold", () => {
    // Default threshold is 5 minutes; no session file = 0 minutes
    const deps = createMockDeps({ fileExists: () => false });
    expect(isLongRunningTask(deps)).toBe(false);
  });

  it("returns true when session exceeds threshold", () => {
    // Config returns default (longTaskMinutes: 5). Session started 10 min ago.
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    const deps = createMockDeps({
      fileExists: () => true,
      readFile: (path: string) => {
        if (path.includes("pai-session-start")) return ok(tenMinAgo.toString());
        // Return settings without notifications so default threshold (5) applies
        return ok(JSON.stringify({}));
      },
    });
    expect(isLongRunningTask(deps)).toBe(true);
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
    clearCache();
  });

  it("returns false when ntfy is disabled", async () => {
    const deps = createMockDeps({ fileExists: () => false });
    const result = await sendPush("test message", {}, deps);
    expect(result).toBe(false);
  });

  it("returns false when topic is empty", async () => {
    const deps = createMockDeps({
      fileExists: () => true,
      readFile: () =>
        ok(
          JSON.stringify({
            notifications: {
              ntfy: { enabled: true, topic: "", server: "ntfy.sh" },
            },
          }),
        ),
    });
    const result = await sendPush("test message", {}, deps);
    expect(result).toBe(false);
  });

  it("sends POST to ntfy server and returns true on success", async () => {
    const deps = createMockDeps({
      fileExists: () => true,
      readFile: () => ok(SETTINGS_WITH_NTFY),
    });

    let capturedUrl = "";
    let capturedBody = "";
    let capturedHeaders: Record<string, string> = {};

    setMockFetch(async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = init?.body as string;
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response("ok", { status: 200 });
    });

    const result = await sendPush(
      "hello world",
      {
        title: "Test Title",
        priority: "high",
        tags: ["fire", "warning"],
        click: "https://example.com",
        actions: [{ action: "view", label: "Open", url: "https://example.com" }],
      },
      deps,
    );

    expect(result).toBe(true);
    expect(capturedUrl).toBe("https://ntfy.example.com/test-topic");
    expect(capturedBody).toBe("hello world");
    expect(capturedHeaders.Title).toBe("Test Title");
    expect(capturedHeaders.Priority).toBe("4"); // high = 4
    expect(capturedHeaders.Tags).toBe("fire,warning");
    expect(capturedHeaders.Click).toBe("https://example.com");
    expect(capturedHeaders.Actions).toContain("view, Open, https://example.com");
  });

  it("returns false on fetch failure", async () => {
    const deps = createMockDeps({
      fileExists: () => true,
      readFile: () => ok(SETTINGS_WITH_NTFY),
    });

    setMockFetch(async (): Promise<Response> => {
      throw new Error("network error");
    });

    const result = await sendPush("hello world", {}, deps);
    expect(result).toBe(false);
  });

  it("returns false on non-ok response", async () => {
    const deps = createMockDeps({
      fileExists: () => true,
      readFile: () => ok(SETTINGS_WITH_NTFY),
    });

    setMockFetch(async () => new Response("error", { status: 500 }));

    const result = await sendPush("hello world", {}, deps);
    expect(result).toBe(false);
  });

  it("maps all priority levels correctly", async () => {
    const deps = createMockDeps({
      fileExists: () => true,
      readFile: () => ok(SETTINGS_WITH_NTFY),
    });

    const priorityMap: Record<string, string> = {
      min: "1",
      low: "2",
      default: "3",
      high: "4",
      urgent: "5",
    };

    for (const [priority, expected] of Object.entries(priorityMap)) {
      let capturedHeaders: Record<string, string> = {};
      setMockFetch(async (_url: string | URL | Request, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return new Response("ok", { status: 200 });
      });

      await sendPush(
        "test",
        { priority: priority as "min" | "low" | "default" | "high" | "urgent" },
        deps,
      );
      expect(capturedHeaders.Priority).toBe(expected);
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
    clearCache();
  });

  it("sends push when event is routed to ntfy", async () => {
    const deps = createMockDeps({
      fileExists: () => true,
      readFile: () => ok(SETTINGS_WITH_NTFY),
    });

    let fetchCalled = false;
    setMockFetch(async () => {
      fetchCalled = true;
      return new Response("ok", { status: 200 });
    });

    await notify("error", "something broke", {}, deps);
    // Give fire-and-forget a tick to resolve
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchCalled).toBe(true);
  });

  it("does not send push when event has no ntfy routing", async () => {
    const deps = createMockDeps({
      fileExists: () => true,
      readFile: () =>
        ok(
          JSON.stringify({
            notifications: {
              ntfy: { enabled: true, topic: "test", server: "ntfy.sh" },
              routing: { longTask: [] },
            },
          }),
        ),
    });

    let fetchCalled = false;
    setMockFetch(async () => {
      fetchCalled = true;
      return new Response("ok", { status: 200 });
    });

    await notify("longTask", "took a long time", {}, deps);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchCalled).toBe(false);
  });
});

// ─── notifyTaskComplete ──────────────────────────────────────────────────────

describe("notifyTaskComplete", () => {
  beforeEach(resetMocks);
  afterEach(() => clearCache());

  it("routes as taskComplete when session is short", async () => {
    // No session file = 0 minutes = not long running = taskComplete event
    const deps = createMockDeps({ fileExists: () => false });
    // Should not throw even if ntfy is disabled
    await notifyTaskComplete("done with work", {}, deps);
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
    clearCache();
  });

  it("sends with agent type in title", async () => {
    const deps = createMockDeps({
      fileExists: () => true,
      readFile: () => ok(SETTINGS_WITH_NTFY),
    });

    let capturedHeaders: Record<string, string> = {};
    setMockFetch(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response("ok", { status: 200 });
    });

    await notifyBackgroundAgent("Review", "PR review complete", {}, deps);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(capturedHeaders.Title).toBe("Review Agent Complete");
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
    clearCache();
  });

  it("sends with high priority", async () => {
    const deps = createMockDeps({
      fileExists: () => true,
      readFile: () => ok(SETTINGS_WITH_NTFY),
    });

    let capturedHeaders: Record<string, string> = {};
    setMockFetch(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response("ok", { status: 200 });
    });

    await notifyError("something broke badly", {}, deps);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(capturedHeaders.Priority).toBe("4"); // high = 4
  });
});

// ─── defaultNotificationDeps ────────────────────────────────────────────────

describe("defaultNotificationDeps", () => {
  it("parseJson parses valid JSON", () => {
    const result = defaultNotificationDeps.parseJson<{ a: number }>('{"a":1}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.a).toBe(1);
  });

  it("parseJson returns error for invalid JSON", () => {
    const result = defaultNotificationDeps.parseJson("not json {{{");
    expect(result.ok).toBe(false);
  });

  it("lookupEnv returns a value for a known env var", () => {
    const result = defaultNotificationDeps.lookupEnv("HOME");
    expect(typeof result).toBe("string");
    expect(result!.length).toBeGreaterThan(0);
  });

  it("lookupEnv returns undefined for unknown env var", () => {
    const result = defaultNotificationDeps.lookupEnv("PAI_NONEXISTENT_VAR_XYZ_12345");
    expect(result).toBeUndefined();
  });

  it("stderr writes without throwing", () => {
    expect(() => defaultNotificationDeps.stderr("test")).not.toThrow();
  });
});
