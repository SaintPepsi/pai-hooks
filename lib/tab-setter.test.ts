/**
 * Tests for tab-setter.ts — Only pure functions tested.
 *
 * Kitty-specific functions (setTabState, setPhaseTab, persistKittySession,
 * cleanupKittySession, readTabState) are no-ops since kitty removal (#56).
 * Only stripPrefix retains real logic.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { PaiError } from "@hooks/core/error";
import { ok, err } from "@hooks/core/result";
import { fileReadFailed } from "@hooks/core/error";
import type { TabSetterDeps } from "@hooks/lib/tab-setter";
import { stripPrefix } from "@hooks/lib/tab-setter";

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

