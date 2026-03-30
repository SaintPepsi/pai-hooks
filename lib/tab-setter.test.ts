/**
 * Tests for tab-setter.ts — Only pure functions tested.
 *
 * Kitty-specific functions (setTabState, setPhaseTab, persistKittySession,
 * cleanupKittySession, readTabState) are no-ops since kitty removal (#56).
 * Only stripPrefix and getSessionOneWord retain real logic.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { ResultError } from "@hooks/core/error";
import { ok, err } from "@hooks/core/result";
import { fileReadFailed } from "@hooks/core/error";
import type { TabSetterDeps } from "@hooks/lib/tab-setter";
import { getSessionOneWord, stripPrefix } from "@hooks/lib/tab-setter";

// ─── Mock deps factory ─────────────────────────────────────────────────────

const mockFileExists = mock((_path: string): boolean => false);
const mockWriteFile = mock((_path: string, _content: string) => ok(undefined));
const mockEnsureDir = mock((_path: string) => ok(undefined));
const mockReadDir = mock((_path: string) => ok([] as string[]));
const mockRemoveFile = mock((_path: string) => ok(undefined));
const mockReadFile = mock((_path: string) => ok(""));
const mockReadJson = mock((_path: string) =>
  err(fileReadFailed(_path, new Error("not set"))) as ReturnType<TabSetterDeps["readJson"]>,
);
const mockExecSync = mock((_cmd: string) => ok(""));
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
    readJson: mockReadJson as TabSetterDeps["readJson"],
    execSync: mockExecSync,
    getEnv: mockGetEnv,
    stderr: mockStderr,
  };
}

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

  mockFileExists.mockReturnValue(false);
  mockWriteFile.mockReturnValue(ok(undefined));
  mockEnsureDir.mockReturnValue(ok(undefined));
  mockReadDir.mockReturnValue(ok([]));
  mockRemoveFile.mockReturnValue(ok(undefined));
  mockReadFile.mockReturnValue(ok(""));
  mockReadJson.mockImplementation((_path: string) =>
    err(fileReadFailed(_path, new Error("not set"))),
  );
  mockExecSync.mockReturnValue(ok(""));
  mockGetEnv.mockReturnValue(undefined);
  mockStderr.mockImplementation(() => {});
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
    expect(getSessionOneWord("sess-1", deps)).toBe("ACTIVITY DASHBOARD");
  });

  it("returns two meaningful words even when noise words are between them", () => {
    mockFileExists.mockReturnValue(true);
    mockReadJson.mockImplementation(() => ok({ "sess-1": "Security for apps" } as never));
    const deps = makeDeps();
    expect(getSessionOneWord("sess-1", deps)).toBe("SECURITY APPS");
  });

  it("returns single meaningful word with next word when only one meaningful", () => {
    mockFileExists.mockReturnValue(true);
    mockReadJson.mockImplementation(() => ok({ "sess-1": "Dashboard for the" } as never));
    const deps = makeDeps();
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
    mockReadJson.mockImplementation((_path: string) =>
      err(fileReadFailed(_path, new Error("parse error"))),
    );
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
