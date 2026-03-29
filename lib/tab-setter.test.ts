/**
 * Tests for tab-setter.ts — Tab state management, Kitty integration, and session persistence.
 *
 * Mocking strategy:
 * - Mock 'fs' for all filesystem operations
 * - Mock 'child_process' for execSync (kitten @ commands)
 * - Mock './paths' for paiPath
 * - Environment control via mockEnv object injected through mock.module('process')
 *
 * Note: tab-setter.ts reads process.env directly (pre-dating the Deps pattern,
 * tracked in issue #29). We mock the process module to control env vars without
 * direct process.env mutation in the test file.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { join } from "path";

// ─── Environment mock ────────────────────────────────────────────────────────
// Central env state that tab-setter will read via the mocked process module.

const mockEnv: Record<string, string | undefined> = {};

function setMockEnv(overrides: Record<string, string | undefined>): void {
  // Clear all keys first
  for (const key of Object.keys(mockEnv)) {
    delete mockEnv[key];
  }
  for (const [key, val] of Object.entries(overrides)) {
    if (val !== undefined) mockEnv[key] = val;
  }
}

// ─── Module-level mocks ─────────────────────────────────────────────────────

const mockExistsSync = mock((_path: string) => false);
const mockWriteFileSync = mock((_path: string, _data: string, _enc?: string) => {});
const mockMkdirSync = mock((_path: string, _opts?: { recursive: boolean }) => undefined);
const mockReaddirSync = mock((_path: string) => [] as string[]);
const mockUnlinkSync = mock((_path: string) => {});
const mockReadFileSync = mock((_path: string, _enc?: string) => "");

mock.module("fs", () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  readdirSync: mockReaddirSync,
  unlinkSync: mockUnlinkSync,
}));

const mockExecSync = mock((_cmd: string, _opts?: Record<string, unknown>) => "");

mock.module("child_process", () => ({
  execSync: mockExecSync,
}));

// Mock paths to return predictable test directories
mock.module("./paths", () => ({
  paiPath: (...segments: string[]) => join("/tmp/test-pai", ...segments),
}));

// Import AFTER mocks
import {
  cleanupKittySession,
  getSessionOneWord,
  persistKittySession,
  readTabState,
  setPhaseTab,
  setTabState,
  stripPrefix,
} from "@hooks/lib/tab-setter";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resetAllMocks(): void {
  mockExistsSync.mockReset();
  mockWriteFileSync.mockReset();
  mockMkdirSync.mockReset();
  mockReaddirSync.mockReset();
  mockUnlinkSync.mockReset();
  mockReadFileSync.mockReset();
  mockExecSync.mockReset();
  mockExistsSync.mockReturnValue(false);
  mockReaddirSync.mockReturnValue([]);
  mockReadFileSync.mockReturnValue("");
  mockExecSync.mockReturnValue("");
}

// ─── stripPrefix (pure function — no I/O) ────────────────────────────────────

describe("stripPrefix", () => {
  it("strips brain emoji prefix", () => {
    expect(stripPrefix("🧠 Working on auth")).toBe("Working on auth");
  });

  it("strips gear emoji prefix", () => {
    expect(stripPrefix("⚙️ Processing data")).toBe("Processing data");
  });

  it("strips checkmark prefix", () => {
    expect(stripPrefix("✓ Auth fixed")).toBe("Auth fixed");
  });

  it("strips question mark prefix", () => {
    expect(stripPrefix("❓ Config issue")).toBe("Config issue");
  });

  it("strips Algorithm phase symbols", () => {
    expect(stripPrefix("👁️ Observing")).toBe("Observing");
    expect(stripPrefix("📋 Planning")).toBe("Planning");
    expect(stripPrefix("🔨 Building")).toBe("Building");
    expect(stripPrefix("⚡ Executing")).toBe("Executing");
    expect(stripPrefix("✅ Complete")).toBe("Complete");
    expect(stripPrefix("📚 Learning")).toBe("Learning");
  });

  it("returns text unchanged when no prefix", () => {
    expect(stripPrefix("Plain title")).toBe("Plain title");
  });

  it("handles empty string", () => {
    expect(stripPrefix("")).toBe("");
  });
});

// ─── persistKittySession / cleanupKittySession ──────────────────────────────

describe("persistKittySession", () => {
  beforeEach(resetAllMocks);

  it("creates directory if it does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    persistKittySession("sess-123", "unix:/tmp/kitty", "42");
    expect(mockMkdirSync).toHaveBeenCalled();
  });

  it("writes session file with listenOn and windowId", () => {
    mockExistsSync.mockReturnValue(true); // Dir exists
    persistKittySession("sess-abc", "unix:/tmp/kitty", "99");
    expect(mockWriteFileSync).toHaveBeenCalled();
    const [path, data] = mockWriteFileSync.mock.calls[0];
    expect(path).toContain("sess-abc.json");
    const parsed = JSON.parse(data as string);
    expect(parsed.listenOn).toBe("unix:/tmp/kitty");
    expect(parsed.windowId).toBe("99");
  });
});

describe("cleanupKittySession", () => {
  beforeEach(resetAllMocks);

  it("removes session file when it exists", () => {
    mockExistsSync.mockReturnValue(true);
    cleanupKittySession("sess-123");
    expect(mockUnlinkSync).toHaveBeenCalled();
    expect(String(mockUnlinkSync.mock.calls[0][0])).toContain("sess-123.json");
  });

  it("does nothing when session file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    cleanupKittySession("sess-123");
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });
});

// ─── getSessionOneWord (reads fs, not env) ───────────────────────────────────

describe("getSessionOneWord", () => {
  beforeEach(resetAllMocks);

  it("returns null when session-names.json does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(getSessionOneWord("sess-1")).toBeNull();
  });

  it("returns null when session ID not found in names file", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ "other-sess": "Tab Title Upgrade" }));
    expect(getSessionOneWord("sess-1")).toBeNull();
  });

  it("extracts two meaningful words in uppercase", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ "sess-1": "Tab Title Upgrade" }));
    expect(getSessionOneWord("sess-1")).toBe("TAB TITLE");
  });

  it("skips noise words", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ "sess-1": "Fix Activity Dashboard" }));
    // "Fix" is noise, "Activity" and "Dashboard" are meaningful
    expect(getSessionOneWord("sess-1")).toBe("ACTIVITY DASHBOARD");
  });

  it("returns two meaningful words even when noise words are between them", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ "sess-1": "Security for apps" }));
    // "Security" and "apps" are both meaningful → first two meaningful words
    expect(getSessionOneWord("sess-1")).toBe("SECURITY APPS");
  });

  it("returns single meaningful word with next word when only one meaningful", () => {
    mockExistsSync.mockReturnValue(true);
    // "Dashboard" is the only meaningful word; "for" and "the" are noise
    mockReadFileSync.mockReturnValue(JSON.stringify({ "sess-1": "Dashboard for the" }));
    // Only 1 meaningful word ("Dashboard"), next word is "for"
    expect(getSessionOneWord("sess-1")).toBe("DASHBOARD FOR");
  });

  it("returns first two words when all are noise", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ "sess-1": "fix the old" }));
    expect(getSessionOneWord("sess-1")).toBe("FIX THE");
  });

  it("returns single uppercase word when only one meaningful word and no next word", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ "sess-1": "Security" }));
    expect(getSessionOneWord("sess-1")).toBe("SECURITY");
  });

  it("returns null on malformed JSON", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{bad json");
    expect(getSessionOneWord("sess-1")).toBeNull();
  });

  it("returns null for empty session name", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ "sess-1": "   " }));
    expect(getSessionOneWord("sess-1")).toBeNull();
  });
});

// ─── setTabState (env-dependent via getKittyEnv) ─────────────────────────────
// These tests exercise setTabState using the sessionId parameter path
// through getKittyEnv, which reads persisted session files as a fallback
// when env vars are absent. This avoids direct process.env mutation.

describe("setTabState with session file fallback", () => {
  beforeEach(resetAllMocks);

  it("executes kitten commands when session file provides kitty env", () => {
    // getKittyEnv reads session file when env vars are absent
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        listenOn: "unix:/tmp/kitty-test",
        windowId: "42",
      }),
    );

    setTabState({ title: "Testing hooks", state: "working", sessionId: "sess-1" });

    const commands = mockExecSync.mock.calls.map((c) => String(c[0]));
    const tabTitleCmd = commands.find((c) => c.includes("set-tab-title"));
    const windowTitleCmd = commands.find((c) => c.includes("set-window-title"));
    expect(tabTitleCmd).toBeDefined();
    expect(windowTitleCmd).toBeDefined();
    expect(tabTitleCmd).toContain("Testing hooks");
  });

  it("uses --to flag with socket from session file", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        listenOn: "unix:/tmp/my-socket",
        windowId: "42",
      }),
    );

    setTabState({ title: "Socket test", state: "working", sessionId: "sess-1" });

    const commands = mockExecSync.mock.calls.map((c) => String(c[0]));
    for (const cmd of commands) {
      if (cmd.includes("kitten @")) {
        expect(cmd).toContain('--to="unix:/tmp/my-socket"');
      }
    }
  });

  it("sets non-default colors for working state", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        listenOn: "unix:/tmp/kitty",
        windowId: "42",
      }),
    );

    setTabState({ title: "Working", state: "working", sessionId: "sess-1" });

    const commands = mockExecSync.mock.calls.map((c) => String(c[0]));
    const colorCmd = commands.find((c) => c.includes("set-tab-color"));
    expect(colorCmd).toBeDefined();
    expect(colorCmd).toContain("active_bg=");
    // Working state should NOT have 'none' colors
    expect(colorCmd).not.toContain("active_bg=none");
  });

  it("resets all colors for idle state", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        listenOn: "unix:/tmp/kitty",
        windowId: "42",
      }),
    );

    setTabState({ title: "Idle", state: "idle", sessionId: "sess-1" });

    const commands = mockExecSync.mock.calls.map((c) => String(c[0]));
    const colorCmd = commands.find((c) => c.includes("set-tab-color"));
    expect(colorCmd).toContain("active_bg=none");
    expect(colorCmd).toContain("active_fg=none");
  });

  it("persists state to per-window JSON file", () => {
    mockExistsSync.mockImplementation((path: string) => {
      // Session file exists, tab-titles dir does not
      return String(path).includes("kitty-sessions");
    });
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        listenOn: "unix:/tmp/kitty",
        windowId: "42",
      }),
    );

    setTabState({ title: "Building auth", state: "working", sessionId: "sess-1" });

    // Find the write to the per-window state file (not the kitty-sessions file)
    const stateWrite = mockWriteFileSync.mock.calls.find(
      (c) => String(c[0]).includes("42.json") && String(c[0]).includes("tab-titles"),
    );
    expect(stateWrite).toBeDefined();
    const persisted = JSON.parse(stateWrite![1] as string);
    expect(persisted.title).toBe("Building auth");
    expect(persisted.state).toBe("working");
  });

  it("removes state file on idle", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        listenOn: "unix:/tmp/kitty",
        windowId: "42",
      }),
    );

    setTabState({ title: "Done", state: "idle", sessionId: "sess-1" });

    const unlinkPaths = mockUnlinkSync.mock.calls.map((c) => String(c[0]));
    const stateUnlink = unlinkPaths.find((p) => p.includes("42.json"));
    expect(stateUnlink).toBeDefined();
  });

  it("includes previousTitle in persisted state when provided", () => {
    mockExistsSync.mockImplementation((path: string) => String(path).includes("kitty-sessions"));
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        listenOn: "unix:/tmp/kitty",
        windowId: "42",
      }),
    );

    setTabState({
      title: "New task",
      state: "thinking",
      previousTitle: "Old task",
      sessionId: "sess-1",
    });

    const stateWrite = mockWriteFileSync.mock.calls.find((c) => String(c[0]).includes("42.json"));
    expect(stateWrite).toBeDefined();
    const persisted = JSON.parse(stateWrite![1] as string);
    expect(persisted.previousTitle).toBe("Old task");
  });
});

describe("setTabState without kitty env", () => {
  beforeEach(resetAllMocks);

  it("does nothing when no kitty env is available", () => {
    // No env vars, no session file, no default socket
    mockExistsSync.mockReturnValue(false);
    setTabState({ title: "Test", state: "working" });
    expect(mockExecSync).not.toHaveBeenCalled();
  });
});

// ─── readTabState ────────────────────────────────────────────────────────────
// Note: readTabState uses `require('fs').readFileSync` internally (line 222
// of tab-setter.ts), which bypasses ESM mock.module. The getKittyEnv lookup
// for the session file IS mockable, but the final state file read is not.
// We test the null-path behavior (no windowId) and document the limitation.

describe("readTabState", () => {
  beforeEach(resetAllMocks);

  it("returns null when no windowId is available", () => {
    // No env vars, no session file → getKittyEnv returns null windowId
    mockExistsSync.mockReturnValue(false);
    expect(readTabState("sess-nonexistent")).toBeNull();
  });

  it("returns null when session file provides no windowId", () => {
    mockExistsSync.mockReturnValue(true);
    // Session file exists but has no windowId
    mockReadFileSync.mockReturnValue(JSON.stringify({ listenOn: "unix:/tmp/kitty" }));
    expect(readTabState("sess-1")).toBeNull();
  });

  it("returns null without session ID and no env vars", () => {
    mockExistsSync.mockReturnValue(false);
    expect(readTabState()).toBeNull();
  });
});

// ─── setPhaseTab ─────────────────────────────────────────────────────────────

describe("setPhaseTab", () => {
  beforeEach(resetAllMocks);

  it("does nothing for unknown phase", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        listenOn: "unix:/tmp/kitty",
        windowId: "42",
      }),
    );
    setPhaseTab("NONEXISTENT", "sess-1");
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("does nothing when no kitty env available", () => {
    mockExistsSync.mockReturnValue(false);
    setPhaseTab("BUILD", "sess-1");
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("sets title with phase symbol and session word for active phases", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((_path: string) => {
      if (String(_path).includes("kitty-sessions")) {
        return JSON.stringify({ listenOn: "unix:/tmp/kitty", windowId: "42" });
      }
      if (String(_path).includes("session-names")) {
        return JSON.stringify({ "sess-1": "Auth Redesign" });
      }
      return "{}";
    });

    setPhaseTab("BUILD", "sess-1");

    const commands = mockExecSync.mock.calls.map((c) => String(c[0]));
    const tabCmd = commands.find((c) => c.includes("set-tab-title"));
    expect(tabCmd).toBeDefined();
    expect(tabCmd).toContain("AUTH REDESIGN");
  });

  it("uses COMPLETE title with summary when provided", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((_path: string) => {
      if (String(_path).includes("kitty-sessions")) {
        return JSON.stringify({ listenOn: "unix:/tmp/kitty", windowId: "42" });
      }
      return JSON.stringify({ "sess-1": "Auth Work" });
    });

    setPhaseTab("COMPLETE", "sess-1", "Deployed auth module");

    const commands = mockExecSync.mock.calls.map((c) => String(c[0]));
    const tabCmd = commands.find((c) => c.includes("set-tab-title"));
    expect(tabCmd).toContain("Deployed auth module");
  });

  it("falls back to session word for COMPLETE without summary", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((_path: string) => {
      if (String(_path).includes("kitty-sessions")) {
        return JSON.stringify({ listenOn: "unix:/tmp/kitty", windowId: "42" });
      }
      return JSON.stringify({ "sess-1": "Auth Work" });
    });

    setPhaseTab("COMPLETE", "sess-1");

    const commands = mockExecSync.mock.calls.map((c) => String(c[0]));
    const tabCmd = commands.find((c) => c.includes("set-tab-title"));
    expect(tabCmd).toContain("AUTH WORK");
  });

  it("falls back to WORKING when session name not found", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((_path: string) => {
      if (String(_path).includes("kitty-sessions")) {
        return JSON.stringify({ listenOn: "unix:/tmp/kitty", windowId: "42" });
      }
      // session-names.json has no entry for this session
      return JSON.stringify({});
    });

    setPhaseTab("OBSERVE", "sess-unknown");

    const commands = mockExecSync.mock.calls.map((c) => String(c[0]));
    const tabCmd = commands.find((c) => c.includes("set-tab-title"));
    expect(tabCmd).toBeDefined();
    expect(tabCmd).toContain("WORKING");
  });

  it("resets colors for IDLE phase", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        listenOn: "unix:/tmp/kitty",
        windowId: "42",
      }),
    );

    setPhaseTab("IDLE", "sess-1");

    const commands = mockExecSync.mock.calls.map((c) => String(c[0]));
    const colorCmd = commands.find((c) => c.includes("set-tab-color"));
    expect(colorCmd).toContain("active_bg=none");
  });

  it("persists phase to per-window state file", () => {
    mockExistsSync.mockImplementation((_path: string) => String(_path).includes("kitty-sessions"));
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        listenOn: "unix:/tmp/kitty",
        windowId: "42",
      }),
    );

    setPhaseTab("EXECUTE", "sess-1");

    const writeCall = mockWriteFileSync.mock.calls.find((c) => String(c[0]).includes("42.json"));
    expect(writeCall).toBeDefined();
    const persisted = JSON.parse(writeCall![1] as string);
    expect(persisted.phase).toBe("EXECUTE");
    expect(persisted.state).toBe("working");
  });

  it("persists completed state for COMPLETE phase", () => {
    mockExistsSync.mockImplementation((_path: string) => String(_path).includes("kitty-sessions"));
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        listenOn: "unix:/tmp/kitty",
        windowId: "42",
      }),
    );

    setPhaseTab("COMPLETE", "sess-1");

    const writeCall = mockWriteFileSync.mock.calls.find((c) => String(c[0]).includes("42.json"));
    expect(writeCall).toBeDefined();
    const persisted = JSON.parse(writeCall![1] as string);
    expect(persisted.state).toBe("completed");
  });
});
