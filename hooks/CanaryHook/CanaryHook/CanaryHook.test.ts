import { describe, expect, test } from "bun:test";
import { ErrorCode, ResultError } from "@hooks/core/error";
import { err, ok } from "@hooks/core/result";
import type { SessionStartInput } from "@hooks/core/types/hook-inputs";
import { CanaryHook, type CanaryHookDeps } from "./CanaryHook.contract";

const mockInput: SessionStartInput = {
  hook_event_name: "SessionStart",
  session_id: "test-session",
};

function makeDeps(overrides: Partial<CanaryHookDeps> = {}): CanaryHookDeps {
  return {
    appendFile: () => ok(undefined),
    ensureDir: () => ok(undefined),
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

  test("propagates ensureDir errors", () => {
    const deps = makeDeps({
      ensureDir: () => err(new ResultError(ErrorCode.FileWriteFailed, "permission denied")),
    });
    const result = CanaryHook.execute(mockInput, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.FileWriteFailed);
    }
  });

  test("propagates appendFile errors", () => {
    const deps = makeDeps({
      appendFile: () => err(new ResultError(ErrorCode.FileWriteFailed, "disk full")),
    });
    const result = CanaryHook.execute(mockInput, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(ErrorCode.FileWriteFailed);
    }
  });
});
