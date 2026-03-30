/**
 * Tests for tab-setter.ts — Tab state management, Kitty integration, and session persistence.
 *
 * Mocking strategy:
 * - Use TabSetterDeps injection (NO mock.module — it leaks globally in bun test)
 * - All exported functions accept a deps parameter
 * - Mock deps provide test doubles for filesystem, exec, and env
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { PaiError } from "@hooks/core/error";
import { ok, err } from "@hooks/core/result";
import type { Result } from "@hooks/core/result";
import { fileReadFailed } from "@hooks/core/error";
import type { TabSetterDeps } from "@hooks/lib/tab-setter";
import {
  cleanupKittySession,
  getSessionOneWord,
  persistKittySession,
  readTabState,
  setPhaseTab,
  setTabState,
  stripPrefix,
} from "@hooks/lib/tab-setter";

// ─── Mock deps factory ─────────────────────────────────────────────────────

const mockFileExists = mock((_path: string): boolean => false);
const mockWriteFile = mock((_path: string, _content: string): Result<void, PaiError> => ok(undefined));
const mockEnsureDir = mock((_path: string): Result<void, PaiError> => ok(undefined));
const mockReadDir = mock((_path: string): Result<string[], PaiError> => ok([]));
const mockRemoveFile = mock((_path: string): Result<void, PaiError> => ok(undefined));
const mockReadFile = mock((_path: string): Result<string, PaiError> => ok(""));
const mockReadJson = mock(<T>(_path: string): Result<T, PaiError> => err(fileReadFailed(_path, new Error("not set"))));
const mockExecSync = mock((_cmd: string, _opts?: { timeout?: number; stdio?: "pipe" | "inherit" | "ignore" }): Result<string, PaiError> => ok(""));
const mockGetEnv = mock((_name: string): string | undefined => undefined);
const mockStderr = mock((_msg: string): void => {});

function makeDeps(): TabSetterDeps {
  return {
    fileExists: mockFileExists,
    writeFile: mockWriteFile,
    ensureDir: mockEnsureDir,
    readDir: mockReadDir,
    removeFile: mockRemoveFile,
    readFile: mockReadFile,
    readJson: mockReadJson,
    execSync: mockExecSync,
    getEnv: mockGetEnv,
    stderr: mockStderr,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resetAllMocks(): void {
  mockFileExists.mockReset();
  mockWriteFile.mockReset();
  mockEnsureDir.mockReset();
  mockReadDir.mockReset();
  mockRemoveFile.mockReset();
  mockReadFile.mockReset();
  mockReadJson.mockReset();
  mockExecSync.mockReset();
  mockGetEnv.mockReset();
  mockStderr.mockReset();

  // Defaults
  mockFileExists.mockReturnValue(false);
  mockWriteFile.mockReturnValue(ok(undefined));
  mockEnsureDir.mockReturnValue(ok(undefined));
  mockReadDir.mockReturnValue(ok([]));
  mockRemoveFile.mockReturnValue(ok(undefined));
  mockReadFile.mockReturnValue(ok(""));
  mockReadJson.mockImplementation((_path: string) => err(fileReadFailed(_path, new Error("not set"))));
  mockExecSync.mockReturnValue(ok(""));
  mockGetEnv.mockReturnValue(undefined);
  mockStderr.mockImplementation(() => {});
}

/**
 * Helper: configure mocks so getKittyEnv resolves from session file.
 * Sets fileExists to true and readJson to return kitty env with given socket + windowId.
 */
function setupKittySessionEnv(listenOn: string, windowId: string): void {
  mockFileExists.mockReturnValue(true);
  mockReadJson.mockImplementation((_path: string) =>
    ok({ listenOn, windowId } as never),
  );
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
    mockFileExists.mockReturnValue(false);
    const deps = makeDeps();
    persistKittySession("sess-123", "unix:/tmp/kitty", "42", deps);
    expect(mockEnsureDir).toHaveBeenCalled();
  });

  it("writes session file with listenOn and windowId", () => {
    mockFileExists.mockReturnValue(true); // Dir exists
    const deps = makeDeps();
    persistKittySession("sess-abc", "unix:/tmp/kitty", "99", deps);
    expect(mockWriteFile).toHaveBeenCalled();
    const [path, data] = mockWriteFile.mock.calls[0];
    expect(path).toContain("sess-abc.json");
    const parsed = JSON.parse(data as string);
    expect(parsed.listenOn).toBe("unix:/tmp/kitty");
    expect(parsed.windowId).toBe("99");
  });
});

describe("cleanupKittySession", () => {
  beforeEach(resetAllMocks);

  it("removes session file when it exists", () => {
    mockFileExists.mockReturnValue(true);
    const deps = makeDeps();
    cleanupKittySession("sess-123", deps);
    expect(mockRemoveFile).toHaveBeenCalled();
    expect(String(mockRemoveFile.mock.calls[0][0])).toContain("sess-123.json");
  });

  it("does nothing when session file does not exist", () => {
    mockFileExists.mockReturnValue(false);
    const deps = makeDeps();
    cleanupKittySession("sess-123", deps);
    expect(mockRemoveFile).not.toHaveBeenCalled();
  });
});

// ─── getSessionOneWord (reads fs, not env) ───────────────────────────────────

describe("getSessionOneWord", () => {
  beforeEach(resetAllMocks);

  it("returns null when session-names.json does not exist", () => {
    mockFileExists.mockReturnValue(false);
    const deps = makeDeps();
    expect(getSessionOneWord("sess-1", deps)).toBeNull();
  });

  it("returns null when session ID not found in names file", () => {
    mockFileExists.mockReturnValue(true);
    mockReadJson.mockImplementation(() => ok({ "other-sess": "Tab Title Upgrade" } as never));
    const deps = makeDeps();
    expect(getSessionOneWord("sess-1", deps)).toBeNull();
  });

  it("extracts two meaningful words in uppercase", () => {
    mockFileExists.mockReturnValue(true);
    mockReadJson.mockImplementation(() => ok({ "sess-1": "Tab Title Upgrade" } as never));
    const deps = makeDeps();
    expect(getSessionOneWord("sess-1", deps)).toBe("TAB TITLE");
  });

  it("skips noise words", () => {
    mockFileExists.mockReturnValue(true);
    mockReadJson.mockImplementation(() => ok({ "sess-1": "Fix Activity Dashboard" } as never));
    const deps = makeDeps();
    // "Fix" is noise, "Activity" and "Dashboard" are meaningful
    expect(getSessionOneWord("sess-1", deps)).toBe("ACTIVITY DASHBOARD");
  });

  it("returns two meaningful words even when noise words are between them", () => {
    mockFileExists.mockReturnValue(true);
    mockReadJson.mockImplementation(() => ok({ "sess-1": "Security for apps" } as never));
    const deps = makeDeps();
    // "Security" and "apps" are both meaningful
    expect(getSessionOneWord("sess-1", deps)).toBe("SECURITY APPS");
  });

  it("returns single meaningful word with next word when only one meaningful", () => {
    mockFileExists.mockReturnValue(true);
    mockReadJson.mockImplementation(() => ok({ "sess-1": "Dashboard for the" } as never));
    const deps = makeDeps();
    // Only 1 meaningful word ("Dashboard"), next word is "for"
    expect(getSessionOneWord("sess-1", deps)).toBe("DASHBOARD FOR");
  });

  it("returns first two words when all are noise", () => {
    mockFileExists.mockReturnValue(true);
    mockReadJson.mockImplementation(() => ok({ "sess-1": "fix the old" } as never));
    const deps = makeDeps();
    expect(getSessionOneWord("sess-1", deps)).toBe("FIX THE");
  });

  it("returns single uppercase word when only one meaningful word and no next word", () => {
    mockFileExists.mockReturnValue(true);
    mockReadJson.mockImplementation(() => ok({ "sess-1": "Security" } as never));
    const deps = makeDeps();
    expect(getSessionOneWord("sess-1", deps)).toBe("SECURITY");
  });

  it("returns null on malformed JSON", () => {
    mockFileExists.mockReturnValue(true);
    mockReadJson.mockImplementation((_path: string) => err(fileReadFailed(_path, new Error("parse error"))));
    const deps = makeDeps();
    expect(getSessionOneWord("sess-1", deps)).toBeNull();
  });

  it("returns null for empty session name", () => {
    mockFileExists.mockReturnValue(true);
    mockReadJson.mockImplementation(() => ok({ "sess-1": "   " } as never));
    const deps = makeDeps();
    expect(getSessionOneWord("sess-1", deps)).toBeNull();
  });
});

// ─── setTabState (env-dependent via getKittyEnv) ─────────────────────────────
// These tests exercise setTabState using the sessionId parameter path
// through getKittyEnv, which reads persisted session files as a fallback
// when env vars are absent. This avoids direct process.env mutation.

describe("setTabState with session file fallback", () => {
  beforeEach(resetAllMocks);

  it("executes kitten commands when session file provides kitty env", () => {
    setupKittySessionEnv("unix:/tmp/kitty-test", "42");
    const deps = makeDeps();

    setTabState({ title: "Testing hooks", state: "working", sessionId: "sess-1" }, deps);

    const commands = mockExecSync.mock.calls.map((c) => String(c[0]));
    const tabTitleCmd = commands.find((c) => c.includes("set-tab-title"));
    const windowTitleCmd = commands.find((c) => c.includes("set-window-title"));
    expect(tabTitleCmd).toBeDefined();
    expect(windowTitleCmd).toBeDefined();
    expect(tabTitleCmd).toContain("Testing hooks");
  });

  it("uses --to flag with socket from session file", () => {
    setupKittySessionEnv("unix:/tmp/my-socket", "42");
    const deps = makeDeps();

    setTabState({ title: "Socket test", state: "working", sessionId: "sess-1" }, deps);

    const commands = mockExecSync.mock.calls.map((c) => String(c[0]));
    for (const cmd of commands) {
      if (cmd.includes("kitten @")) {
        expect(cmd).toContain('--to="unix:/tmp/my-socket"');
      }
    }
  });

  it("sets non-default colors for working state", () => {
    setupKittySessionEnv("unix:/tmp/kitty", "42");
    const deps = makeDeps();

    setTabState({ title: "Working", state: "working", sessionId: "sess-1" }, deps);

    const commands = mockExecSync.mock.calls.map((c) => String(c[0]));
    const colorCmd = commands.find((c) => c.includes("set-tab-color"));
    expect(colorCmd).toBeDefined();
    expect(colorCmd).toContain("active_bg=");
    // Working state should NOT have 'none' colors
    expect(colorCmd).not.toContain("active_bg=none");
  });

  it("resets all colors for idle state", () => {
    setupKittySessionEnv("unix:/tmp/kitty", "42");
    const deps = makeDeps();

    setTabState({ title: "Idle", state: "idle", sessionId: "sess-1" }, deps);

    const commands = mockExecSync.mock.calls.map((c) => String(c[0]));
    const colorCmd = commands.find((c) => c.includes("set-tab-color"));
    expect(colorCmd).toContain("active_bg=none");
    expect(colorCmd).toContain("active_fg=none");
  });

  it("persists state to per-window JSON file", () => {
    mockFileExists.mockImplementation((path: string) => {
      // Session file exists, tab-titles dir does not
      return String(path).includes("kitty-sessions");
    });
    mockReadJson.mockImplementation(() =>
      ok({ listenOn: "unix:/tmp/kitty", windowId: "42" } as never),
    );
    const deps = makeDeps();

    setTabState({ title: "Building auth", state: "working", sessionId: "sess-1" }, deps);

    // Find the write to the per-window state file (not the kitty-sessions file)
    const stateWrite = mockWriteFile.mock.calls.find(
      (c) => String(c[0]).includes("42.json") && String(c[0]).includes("tab-titles"),
    );
    expect(stateWrite).toBeDefined();
    const persisted = JSON.parse(stateWrite![1] as string);
    expect(persisted.title).toBe("Building auth");
    expect(persisted.state).toBe("working");
  });

  it("removes state file on idle", () => {
    setupKittySessionEnv("unix:/tmp/kitty", "42");
    const deps = makeDeps();

    setTabState({ title: "Done", state: "idle", sessionId: "sess-1" }, deps);

    const unlinkPaths = mockRemoveFile.mock.calls.map((c) => String(c[0]));
    const stateUnlink = unlinkPaths.find((p) => p.includes("42.json"));
    expect(stateUnlink).toBeDefined();
  });

  it("includes previousTitle in persisted state when provided", () => {
    mockFileExists.mockImplementation((path: string) => String(path).includes("kitty-sessions"));
    mockReadJson.mockImplementation(() =>
      ok({ listenOn: "unix:/tmp/kitty", windowId: "42" } as never),
    );
    const deps = makeDeps();

    setTabState({
      title: "New task",
      state: "thinking",
      previousTitle: "Old task",
      sessionId: "sess-1",
    }, deps);

    const stateWrite = mockWriteFile.mock.calls.find((c) => String(c[0]).includes("42.json"));
    expect(stateWrite).toBeDefined();
    const persisted = JSON.parse(stateWrite![1] as string);
    expect(persisted.previousTitle).toBe("Old task");
  });
});

describe("setTabState without kitty env", () => {
  beforeEach(resetAllMocks);

  it("does nothing when no kitty env is available", () => {
    // No env vars, no session file, no default socket
    mockFileExists.mockReturnValue(false);
    const deps = makeDeps();
    setTabState({ title: "Test", state: "working" }, deps);
    expect(mockExecSync).not.toHaveBeenCalled();
  });
});

// ─── readTabState ────────────────────────────────────────────────────────────

describe("readTabState", () => {
  beforeEach(resetAllMocks);

  it("returns null when no windowId is available", () => {
    // No env vars, no session file
    mockFileExists.mockReturnValue(false);
    const deps = makeDeps();
    expect(readTabState("sess-nonexistent", deps)).toBeNull();
  });

  it("returns null when session file provides no windowId", () => {
    mockFileExists.mockReturnValue(true);
    // Session file exists but has no windowId
    mockReadJson.mockImplementation(() => ok({ listenOn: "unix:/tmp/kitty" } as never));
    const deps = makeDeps();
    expect(readTabState("sess-1", deps)).toBeNull();
  });

  it("returns null without session ID and no env vars", () => {
    mockFileExists.mockReturnValue(false);
    const deps = makeDeps();
    expect(readTabState(undefined, deps)).toBeNull();
  });
});

// ─── setPhaseTab ─────────────────────────────────────────────────────────────

describe("setPhaseTab", () => {
  beforeEach(resetAllMocks);

  it("does nothing for unknown phase", () => {
    setupKittySessionEnv("unix:/tmp/kitty", "42");
    const deps = makeDeps();
    setPhaseTab("NONEXISTENT", "sess-1", undefined, deps);
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("does nothing when no kitty env available", () => {
    mockFileExists.mockReturnValue(false);
    const deps = makeDeps();
    setPhaseTab("BUILD", "sess-1", undefined, deps);
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("sets title with phase symbol and session word for active phases", () => {
    mockFileExists.mockReturnValue(true);
    mockReadJson.mockImplementation((_path: string) => {
      if (String(_path).includes("kitty-sessions")) {
        return ok({ listenOn: "unix:/tmp/kitty", windowId: "42" } as never);
      }
      if (String(_path).includes("session-names")) {
        return ok({ "sess-1": "Auth Redesign" } as never);
      }
      return ok({} as never);
    });
    const deps = makeDeps();

    setPhaseTab("BUILD", "sess-1", undefined, deps);

    const commands = mockExecSync.mock.calls.map((c) => String(c[0]));
    const tabCmd = commands.find((c) => c.includes("set-tab-title"));
    expect(tabCmd).toBeDefined();
    expect(tabCmd).toContain("AUTH REDESIGN");
  });

  it("uses COMPLETE title with summary when provided", () => {
    mockFileExists.mockReturnValue(true);
    mockReadJson.mockImplementation((_path: string) => {
      if (String(_path).includes("kitty-sessions")) {
        return ok({ listenOn: "unix:/tmp/kitty", windowId: "42" } as never);
      }
      return ok({ "sess-1": "Auth Work" } as never);
    });
    const deps = makeDeps();

    setPhaseTab("COMPLETE", "sess-1", "Deployed auth module", deps);

    const commands = mockExecSync.mock.calls.map((c) => String(c[0]));
    const tabCmd = commands.find((c) => c.includes("set-tab-title"));
    expect(tabCmd).toContain("Deployed auth module");
  });

  it("falls back to session word for COMPLETE without summary", () => {
    mockFileExists.mockReturnValue(true);
    mockReadJson.mockImplementation((_path: string) => {
      if (String(_path).includes("kitty-sessions")) {
        return ok({ listenOn: "unix:/tmp/kitty", windowId: "42" } as never);
      }
      return ok({ "sess-1": "Auth Work" } as never);
    });
    const deps = makeDeps();

    setPhaseTab("COMPLETE", "sess-1", undefined, deps);

    const commands = mockExecSync.mock.calls.map((c) => String(c[0]));
    const tabCmd = commands.find((c) => c.includes("set-tab-title"));
    expect(tabCmd).toContain("AUTH WORK");
  });

  it("falls back to WORKING when session name not found", () => {
    mockFileExists.mockReturnValue(true);
    mockReadJson.mockImplementation((_path: string) => {
      if (String(_path).includes("kitty-sessions")) {
        return ok({ listenOn: "unix:/tmp/kitty", windowId: "42" } as never);
      }
      // session-names.json has no entry for this session
      return ok({} as never);
    });
    const deps = makeDeps();

    setPhaseTab("OBSERVE", "sess-unknown", undefined, deps);

    const commands = mockExecSync.mock.calls.map((c) => String(c[0]));
    const tabCmd = commands.find((c) => c.includes("set-tab-title"));
    expect(tabCmd).toBeDefined();
    expect(tabCmd).toContain("WORKING");
  });

  it("resets colors for IDLE phase", () => {
    setupKittySessionEnv("unix:/tmp/kitty", "42");
    const deps = makeDeps();

    setPhaseTab("IDLE", "sess-1", undefined, deps);

    const commands = mockExecSync.mock.calls.map((c) => String(c[0]));
    const colorCmd = commands.find((c) => c.includes("set-tab-color"));
    expect(colorCmd).toContain("active_bg=none");
  });

  it("persists phase to per-window state file", () => {
    mockFileExists.mockImplementation((_path: string) => String(_path).includes("kitty-sessions"));
    mockReadJson.mockImplementation(() =>
      ok({ listenOn: "unix:/tmp/kitty", windowId: "42" } as never),
    );
    const deps = makeDeps();

    setPhaseTab("EXECUTE", "sess-1", undefined, deps);

    const writeCall = mockWriteFile.mock.calls.find((c) => String(c[0]).includes("42.json"));
    expect(writeCall).toBeDefined();
    const persisted = JSON.parse(writeCall![1] as string);
    expect(persisted.phase).toBe("EXECUTE");
    expect(persisted.state).toBe("working");
  });

  it("persists completed state for COMPLETE phase", () => {
    mockFileExists.mockImplementation((_path: string) => String(_path).includes("kitty-sessions"));
    mockReadJson.mockImplementation(() =>
      ok({ listenOn: "unix:/tmp/kitty", windowId: "42" } as never),
    );
    const deps = makeDeps();

    setPhaseTab("COMPLETE", "sess-1", undefined, deps);

    const writeCall = mockWriteFile.mock.calls.find((c) => String(c[0]).includes("42.json"));
    expect(writeCall).toBeDefined();
    const persisted = JSON.parse(writeCall![1] as string);
    expect(persisted.state).toBe("completed");
  });
});
