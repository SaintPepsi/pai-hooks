import { describe, expect, it } from "bun:test";
import { ErrorCode, ResultError } from "@hooks/core/error";
import { err, ok, type Result } from "@hooks/core/result";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import { getInjectedContextFor } from "@hooks/lib/test-helpers";
import {
  type ArchEscalationDeps,
  ArchitectureEscalation,
  buildWarningMessage,
  getStatePath,
  loadState,
  STOP_THRESHOLD,
  saveState,
  WARN_THRESHOLD,
} from "./ArchitectureEscalation.contract";

/**
 * In-memory fs mock -- no real filesystem needed.
 * State is stored in a Map keyed by file path.
 */
function makeDeps(overrides: Partial<ArchEscalationDeps> = {}): ArchEscalationDeps {
  const store = new Map<string, unknown>();

  return {
    getPaiDir: () => "/mock/pai",
    now: () => Date.now(),
    stderr: () => {},
    fileExists: (path: string) => store.has(path),
    readJson: <T>(path: string): Result<T, ResultError> => {
      if (!store.has(path)) return err(new ResultError(ErrorCode.FileNotFound, path));
      return ok(store.get(path) as T);
    },
    writeJson: (path: string, data: unknown) => {
      store.set(path, JSON.parse(JSON.stringify(data)));
      return ok(undefined);
    },
    ensureDir: () => ok(undefined),
    ...overrides,
  };
}

function makeInput(overrides: Partial<ToolHookInput> = {}): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "TaskUpdate",
    tool_input: { taskId: "C1", status: "in_progress" },
    ...overrides,
  };
}

describe("ArchitectureEscalation", () => {
  it("has correct name and event", () => {
    expect(ArchitectureEscalation.name).toBe("ArchitectureEscalation");
    expect(ArchitectureEscalation.event).toBe("PostToolUse");
  });

  it("accepts TaskUpdate events", () => {
    expect(ArchitectureEscalation.accepts(makeInput())).toBe(true);
  });

  it("rejects non-TaskUpdate events", () => {
    expect(ArchitectureEscalation.accepts(makeInput({ tool_name: "Read" }))).toBe(false);
  });

  it("returns continue with no context on first in_progress", () => {
    const deps = makeDeps();
    const result = ArchitectureEscalation.execute(makeInput(), deps);
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.continue).toBe(true);
    expect(getInjectedContextFor(result.value, "PostToolUse")).toBeUndefined();
  });

  it("warns after WARN_THRESHOLD failures", () => {
    const deps = makeDeps();
    const input = makeInput();

    for (let i = 0; i < WARN_THRESHOLD; i++) {
      ArchitectureEscalation.execute(input, deps);
    }

    const result = ArchitectureEscalation.execute(input, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getInjectedContextFor(result.value, "PostToolUse")).toContain(
      "ARCHITECTURE ESCALATION WARNING",
    );
  });

  it("escalates to STOP after STOP_THRESHOLD failures", () => {
    const deps = makeDeps();
    const input = makeInput();

    for (let i = 0; i < STOP_THRESHOLD; i++) {
      ArchitectureEscalation.execute(input, deps);
    }

    const result = ArchitectureEscalation.execute(input, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getInjectedContextFor(result.value, "PostToolUse")).toContain("STOP CURRENT APPROACH");
  });

  it("returns continue for non-in_progress status", () => {
    const deps = makeDeps();
    const input = makeInput({
      tool_input: { taskId: "C1", status: "completed" },
    });
    const result = ArchitectureEscalation.execute(input, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getInjectedContextFor(result.value, "PostToolUse")).toBeUndefined();
  });

  it("returns continue when taskId is empty string", () => {
    const deps = makeDeps();
    const input = makeInput({
      tool_input: { taskId: "", status: "in_progress" },
    });
    const result = ArchitectureEscalation.execute(input, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getInjectedContextFor(result.value, "PostToolUse")).toBeUndefined();
  });

  it("returns continue when taskId is not a string", () => {
    const deps = makeDeps();
    const input = makeInput({
      tool_input: { taskId: 42, status: "in_progress" },
    });
    const result = ArchitectureEscalation.execute(input, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getInjectedContextFor(result.value, "PostToolUse")).toBeUndefined();
  });

  it("output shape matches Claude Code expectations", () => {
    const deps = makeDeps();
    const result = ArchitectureEscalation.execute(makeInput(), deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = result.value;
    const json = JSON.stringify(output);
    const parsed = JSON.parse(json);
    expect(parsed.continue).toBe(true);
  });

  it("tracks different criteria independently", () => {
    const deps = makeDeps();
    const inputC1 = makeInput({
      tool_input: { taskId: "C1", status: "in_progress" },
    });
    const inputC2 = makeInput({
      tool_input: { taskId: "C2", status: "in_progress" },
    });

    // Push C1 past warn threshold
    for (let i = 0; i <= WARN_THRESHOLD; i++) {
      ArchitectureEscalation.execute(inputC1, deps);
    }

    // C2 should still be clean
    const result = ArchitectureEscalation.execute(inputC2, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getInjectedContextFor(result.value, "PostToolUse")).toBeUndefined();
  });

  it("persists state across execute calls via deps.writeJson", () => {
    let writeCount = 0;
    const store = new Map<string, unknown>();
    const deps = makeDeps({
      fileExists: (path: string) => store.has(path),
      readJson: <T>(path: string): Result<T, ResultError> => {
        if (!store.has(path)) return err(new ResultError(ErrorCode.FileNotFound, path));
        return ok(store.get(path) as T);
      },
      writeJson: (path: string, data: unknown) => {
        writeCount++;
        store.set(path, JSON.parse(JSON.stringify(data)));
        return ok(undefined);
      },
    });

    ArchitectureEscalation.execute(makeInput(), deps);
    ArchitectureEscalation.execute(makeInput(), deps);

    expect(writeCount).toBe(2);
  });
});

describe("loadState", () => {
  it("returns empty state when file does not exist", () => {
    const deps = makeDeps({ fileExists: () => false });
    const state = loadState("test", deps);
    expect(state.sessionId).toBe("test");
    expect(Object.keys(state.criteria)).toHaveLength(0);
  });

  it("returns empty state when readJson fails", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readJson: <T>(_path: string): Result<T, ResultError> =>
        err(new ResultError(ErrorCode.FileReadFailed, "corrupt")),
    });
    const state = loadState("test", deps);
    expect(state.sessionId).toBe("test");
    expect(Object.keys(state.criteria)).toHaveLength(0);
  });

  it("returns parsed state when file exists and is valid", () => {
    const deps = makeDeps({
      fileExists: () => true,
      readJson: <T>(_path: string): Result<T, ResultError> =>
        ok({
          sessionId: "test",
          criteria: { C1: { inProgressCount: 3, lastSeenAt: 100 } },
        } as T),
    });
    const state = loadState("test", deps);
    expect(state.criteria.C1.inProgressCount).toBe(3);
  });
});

describe("saveState", () => {
  it("logs error when writeJson fails", () => {
    const stderrMessages: string[] = [];
    const deps = makeDeps({
      writeJson: () =>
        err({
          code: "WRITE_FAILED",
          message: "disk full",
        } as unknown as ResultError),
      ensureDir: () => ok(undefined),
      stderr: (msg: string) => {
        stderrMessages.push(msg);
      },
    });
    saveState({ sessionId: "test", criteria: {} }, deps);
    expect(stderrMessages.some((m) => m.includes("Failed to save state"))).toBe(true);
  });

  it("succeeds when writeJson succeeds", () => {
    let writtenData: unknown = null;
    const deps = makeDeps({
      writeJson: (_path: string, data: unknown) => {
        writtenData = data;
        return ok(undefined);
      },
      ensureDir: () => ok(undefined),
    });
    saveState(
      {
        sessionId: "test",
        criteria: { C1: { inProgressCount: 1, lastSeenAt: 100 } },
      },
      deps,
    );
    expect(writtenData).not.toBeNull();
  });
});

describe("buildWarningMessage", () => {
  it("returns STOP message at STOP_THRESHOLD", () => {
    const msg = buildWarningMessage("C1", STOP_THRESHOLD);
    expect(msg).toContain("STOP CURRENT APPROACH");
    expect(msg).toContain("C1");
  });

  it("returns WARNING message below STOP_THRESHOLD", () => {
    const msg = buildWarningMessage("C1", WARN_THRESHOLD);
    expect(msg).toContain("ARCHITECTURE ESCALATION WARNING");
    expect(msg).toContain("C1");
  });

  it("returns STOP message above STOP_THRESHOLD", () => {
    const msg = buildWarningMessage("C2", STOP_THRESHOLD + 3);
    expect(msg).toContain("STOP CURRENT APPROACH");
    expect(msg).toContain(String(STOP_THRESHOLD + 3));
  });
});

describe("getStatePath", () => {
  it("includes session ID in path", () => {
    const deps = makeDeps();
    const path = getStatePath("my-session", deps);
    expect(path).toContain("my-session");
    expect(path).toContain("arch-escalation");
  });
});

describe("ArchitectureEscalation defaultDeps", () => {
  it("defaultDeps.getPaiDir returns a string", () => {
    const result = ArchitectureEscalation.defaultDeps.getPaiDir();
    expect(typeof result).toBe("string");
  });

  it("defaultDeps.now returns a number", () => {
    expect(typeof ArchitectureEscalation.defaultDeps.now()).toBe("number");
  });

  it("defaultDeps.stderr writes without throwing", () => {
    expect(() => ArchitectureEscalation.defaultDeps.stderr("test")).not.toThrow();
  });

  it("defaultDeps.fileExists returns a boolean", () => {
    expect(typeof ArchitectureEscalation.defaultDeps.fileExists("/tmp/nonexistent")).toBe(
      "boolean",
    );
  });

  it("defaultDeps.readJson returns a Result", () => {
    const result = ArchitectureEscalation.defaultDeps.readJson("/tmp/nonexistent-pai-12345.json");
    expect(typeof result.ok).toBe("boolean");
  });

  it("defaultDeps.writeJson returns a Result", () => {
    const result = ArchitectureEscalation.defaultDeps.writeJson("/tmp/pai-test-write-12345.json", {
      test: true,
    });
    expect(typeof result.ok).toBe("boolean");
  });

  it("defaultDeps.ensureDir returns a Result", () => {
    const result = ArchitectureEscalation.defaultDeps.ensureDir("/tmp");
    expect(typeof result.ok).toBe("boolean");
  });
});
