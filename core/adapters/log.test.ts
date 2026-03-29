import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeDir } from "@hooks/core/adapters/fs";
import { _resetDirCache, appendHookLog, type HookLogEntry } from "./log";

const TEST_LOG_DIR = join(tmpdir(), `pai-log-test-${process.pid}`);

function makeEntry(overrides: Partial<HookLogEntry> = {}): HookLogEntry {
  return {
    ts: "2026-03-13T02:25:35.123Z",
    hook: "TestHook",
    event: "SessionStart",
    status: "ok",
    duration_ms: 42,
    ...overrides,
  };
}

describe("appendHookLog", () => {
  beforeEach(() => {
    removeDir(TEST_LOG_DIR);
  });

  afterEach(() => {
    removeDir(TEST_LOG_DIR);
  });

  it("creates log dir and writes JSONL entry", () => {
    const entry = makeEntry();
    const result = appendHookLog(entry, TEST_LOG_DIR);
    expect(result.ok).toBe(true);

    const files = new Bun.Glob("*.jsonl").scanSync(TEST_LOG_DIR);
    const logFiles = [...files];
    expect(logFiles.length).toBe(1);
    expect(logFiles[0]).toMatch(/^hook-log-\d{4}-\d{2}-\d{2}\.jsonl$/);

    const content = readFileSync(join(TEST_LOG_DIR, logFiles[0]), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.hook).toBe("TestHook");
    expect(parsed.status).toBe("ok");
    expect(parsed.duration_ms).toBe(42);
  });

  it("appends multiple entries to same file", () => {
    appendHookLog(makeEntry({ hook: "First" }), TEST_LOG_DIR);
    appendHookLog(makeEntry({ hook: "Second" }), TEST_LOG_DIR);

    const files = [...new Bun.Glob("*.jsonl").scanSync(TEST_LOG_DIR)];
    expect(files.length).toBe(1);

    const lines = readFileSync(join(TEST_LOG_DIR, files[0]), "utf-8").trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).hook).toBe("First");
    expect(JSON.parse(lines[1]).hook).toBe("Second");
  });

  it("includes error field when status is error", () => {
    const entry = makeEntry({ status: "error", error: "something broke" });
    appendHookLog(entry, TEST_LOG_DIR);

    const files = [...new Bun.Glob("*.jsonl").scanSync(TEST_LOG_DIR)];
    const content = readFileSync(join(TEST_LOG_DIR, files[0]), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.error).toBe("something broke");
  });

  it("includes optional session_id and output_type", () => {
    const entry = makeEntry({ session_id: "abc-123", output_type: "context" });
    appendHookLog(entry, TEST_LOG_DIR);

    const files = [...new Bun.Glob("*.jsonl").scanSync(TEST_LOG_DIR)];
    const content = readFileSync(join(TEST_LOG_DIR, files[0]), "utf-8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.session_id).toBe("abc-123");
    expect(parsed.output_type).toBe("context");
  });

  it("does not fail when dir already exists", () => {
    mkdirSync(TEST_LOG_DIR, { recursive: true });
    const result = appendHookLog(makeEntry(), TEST_LOG_DIR);
    expect(result.ok).toBe(true);
  });

  it("calls stderr when appendFile fails", () => {
    const todayFile = `hook-log-${new Date().toISOString().split("T")[0]}.jsonl`;
    mkdirSync(join(TEST_LOG_DIR, todayFile), { recursive: true });
    const stderrMessages: string[] = [];
    appendHookLog(makeEntry(), TEST_LOG_DIR, false, (msg: string) => {
      stderrMessages.push(msg);
    });
    expect(stderrMessages.length).toBe(1);
    expect(stderrMessages[0]).toContain("hook-log");
  });
});

describe("appendHookLog — cleanup", () => {
  beforeEach(() => {
    removeDir(TEST_LOG_DIR);
  });

  afterEach(() => {
    removeDir(TEST_LOG_DIR);
  });

  it("deletes files older than 7 days when cleanup triggers", () => {
    mkdirSync(TEST_LOG_DIR, { recursive: true });
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    writeFileSync(join(TEST_LOG_DIR, `hook-log-${oldDate}.jsonl`), '{"old":true}\n');

    appendHookLog(makeEntry(), TEST_LOG_DIR, true);

    expect(existsSync(join(TEST_LOG_DIR, `hook-log-${oldDate}.jsonl`))).toBe(false);

    const todayDate = new Date().toISOString().split("T")[0];
    expect(existsSync(join(TEST_LOG_DIR, `hook-log-${todayDate}.jsonl`))).toBe(true);
  });

  it("keeps files 7 days old or newer", () => {
    mkdirSync(TEST_LOG_DIR, { recursive: true });
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    writeFileSync(join(TEST_LOG_DIR, `hook-log-${recentDate}.jsonl`), '{"recent":true}\n');

    appendHookLog(makeEntry(), TEST_LOG_DIR, true);

    expect(existsSync(join(TEST_LOG_DIR, `hook-log-${recentDate}.jsonl`))).toBe(true);
  });
});

describe("_resetDirCache", () => {
  beforeEach(() => {
    removeDir(TEST_LOG_DIR);
    _resetDirCache();
  });

  afterEach(() => {
    removeDir(TEST_LOG_DIR);
    _resetDirCache();
  });

  it("is exported and callable", () => {
    expect(typeof _resetDirCache).toBe("function");
    _resetDirCache();
  });

  it("allows ensureDir to recreate a removed directory", () => {
    appendHookLog(makeEntry(), TEST_LOG_DIR);
    expect(existsSync(TEST_LOG_DIR)).toBe(true);

    removeDir(TEST_LOG_DIR);
    expect(existsSync(TEST_LOG_DIR)).toBe(false);

    _resetDirCache();
    appendHookLog(makeEntry(), TEST_LOG_DIR);
    expect(existsSync(TEST_LOG_DIR)).toBe(true);
  });
});
