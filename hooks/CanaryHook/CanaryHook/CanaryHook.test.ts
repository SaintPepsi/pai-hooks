import { describe, expect, test } from "bun:test";
import { ok } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import { CanaryHook, type CanaryHookDeps } from "./CanaryHook.contract";

const mockInput: SessionStartInput = {
  hook_type: "SessionStart",
  session_id: "test-session",
};

function makeDeps(overrides: Partial<CanaryHookDeps> = {}): CanaryHookDeps {
  return {
    appendFile: () => ok(undefined),
    ensureDir: () => ok(undefined),
    execSyncSafe: () => ok(""),
    baseDir: "/tmp/test-claude",
    ...overrides,
  };
}

describe("CanaryHook", () => {
  test("has correct name and event", () => {
    expect(CanaryHook.name).toBe("CanaryHook");
    expect(CanaryHook.event).toBe("SessionStart");
  });

  test("accepts all inputs", () => {
    expect(CanaryHook.accepts(mockInput)).toBe(true);
  });

  test("returns continue on successful execution", () => {
    const result = CanaryHook.execute(mockInput, makeDeps());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.type).toBe("continue");
      expect(result.value.continue).toBe(true);
    }
  });

  test("ensures log directory exists", () => {
    let ensuredPath = "";
    const deps = makeDeps({
      ensureDir: (path) => {
        ensuredPath = path;
        return ok(undefined);
      },
    });
    CanaryHook.execute(mockInput, deps);
    expect(ensuredPath).toContain("MEMORY/STATE/logs");
  });

  test("appends timestamp to log file", () => {
    let appendedContent = "";
    let appendedPath = "";
    const deps = makeDeps({
      appendFile: (path, content) => {
        appendedPath = path;
        appendedContent = content;
        return ok(undefined);
      },
    });
    CanaryHook.execute(mockInput, deps);
    expect(appendedPath).toContain("canary-hook.log");
    expect(appendedContent).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("opens log file with code command", () => {
    let executedCmd = "";
    const deps = makeDeps({
      execSyncSafe: (cmd) => {
        executedCmd = cmd;
        return ok("");
      },
    });
    CanaryHook.execute(mockInput, deps);
    expect(executedCmd).toContain("code");
    expect(executedCmd).toContain("canary-hook.log");
  });
});
