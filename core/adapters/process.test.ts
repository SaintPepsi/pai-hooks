import { describe, it, expect } from "bun:test";
import { exec, getEnv, execSyncSafe, spawnSyncSafe } from "./process";
import { ErrorCode } from "../error";

// ─── exec ────────────────────────────────────────────────────────────────────

describe("exec", () => {
  it("captures stdout from successful command", async () => {
    const r = await exec("echo hello");
    expect(r.ok).toBe(true);
    expect(r.value.stdout.trim()).toBe("hello");
    expect(r.value.exitCode).toBe(0);
  });

  it("captures stderr from command", async () => {
    const r = await exec("echo error >&2");
    expect(r.ok).toBe(true);
    expect(r.value.stderr.trim()).toBe("error");
  });

  it("captures non-zero exit code", async () => {
    const r = await exec("exit 42");
    expect(r.ok).toBe(true);
    expect(r.value.exitCode).toBe(42);
  });

  it("supports cwd option", async () => {
    const r = await exec("pwd", { cwd: "/tmp" });
    expect(r.ok).toBe(true);
    // /tmp may resolve to /private/tmp on macOS
    expect(r.value.stdout.trim()).toMatch(/\/tmp$/);
  });
});

// ─── execSyncSafe ───────────────────────────────────────────────────────────

describe("execSyncSafe", () => {
  it("returns stdout from successful command", () => {
    const r = execSyncSafe("echo hello");
    expect(r.ok).toBe(true);
    expect(r.value.trim()).toBe("hello");
  });

  it("returns error for failing command", () => {
    const r = execSyncSafe("exit 1");
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe(ErrorCode.ProcessExecFailed);
  });

  it("supports cwd option", () => {
    const r = execSyncSafe("pwd", { cwd: "/tmp" });
    expect(r.ok).toBe(true);
    expect(r.value.trim()).toMatch(/\/tmp$/);
  });
});

// ─── spawnSyncSafe ──────────────────────────────────────────────────────────

describe("spawnSyncSafe", () => {
  it("returns stdout and exit code", () => {
    const r = spawnSyncSafe("echo", ["hello"]);
    expect(r.ok).toBe(true);
    expect(r.value.stdout.trim()).toBe("hello");
    expect(r.value.exitCode).toBe(0);
  });

  it("captures non-zero exit code", () => {
    const r = spawnSyncSafe("sh", ["-c", "exit 42"]);
    expect(r.ok).toBe(true);
    expect(r.value.exitCode).toBe(42);
  });

  it("supports cwd option", () => {
    const r = spawnSyncSafe("pwd", [], { cwd: "/tmp" });
    expect(r.ok).toBe(true);
    expect(r.value.stdout.trim()).toMatch(/\/tmp$/);
  });
});

// ─── getEnv ──────────────────────────────────────────────────────────────────

describe("getEnv", () => {
  it("returns Ok with value for existing env var", () => {
    const r = getEnv("HOME");
    expect(r.ok).toBe(true);
    expect(r.value.length).toBeGreaterThan(0);
  });

  it("returns ENV_VAR_MISSING for non-existent var", () => {
    const r = getEnv("PAI_TEST_NONEXISTENT_VAR_12345");
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe(ErrorCode.EnvVarMissing);
  });
});
