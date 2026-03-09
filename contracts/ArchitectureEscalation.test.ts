import { describe, it, expect } from "bun:test";
import {
  ArchitectureEscalation,
  WARN_THRESHOLD,
  STOP_THRESHOLD,
  type ArchEscalationDeps,
} from "./ArchitectureEscalation";
import type { ToolHookInput } from "../core/types/hook-inputs";
import { ok } from "../core/result";

/**
 * In-memory fs mock — no real filesystem needed.
 * State is stored in a Map keyed by file path.
 */
function makeDeps(overrides: Partial<ArchEscalationDeps> = {}): ArchEscalationDeps {
  const store = new Map<string, unknown>();

  return {
    getPaiDir: () => "/mock/pai",
    now: () => Date.now(),
    stderr: () => {},
    fileExists: (path: string) => store.has(path),
    readJson: <T>(path: string) => {
      if (!store.has(path)) return { ok: false as const, error: { code: "FileNotFound", message: path } as any };
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
    const r = result as any;
    expect(r.ok).toBe(true);
    expect(r.value.type).toBe("continue");
    expect(r.value.continue).toBe(true);
    expect(r.value.additionalContext).toBeUndefined();
  });

  it("warns after WARN_THRESHOLD failures", () => {
    const deps = makeDeps();
    const input = makeInput();

    for (let i = 0; i < WARN_THRESHOLD; i++) {
      ArchitectureEscalation.execute(input, deps);
    }

    const result = ArchitectureEscalation.execute(input, deps) as any;
    expect(result.ok).toBe(true);
    expect(result.value.additionalContext).toContain("ARCHITECTURE ESCALATION WARNING");
  });

  it("escalates to STOP after STOP_THRESHOLD failures", () => {
    const deps = makeDeps();
    const input = makeInput();

    for (let i = 0; i < STOP_THRESHOLD; i++) {
      ArchitectureEscalation.execute(input, deps);
    }

    const result = ArchitectureEscalation.execute(input, deps) as any;
    expect(result.ok).toBe(true);
    expect(result.value.additionalContext).toContain("STOP CURRENT APPROACH");
  });

  it("returns continue for non-in_progress status", () => {
    const deps = makeDeps();
    const input = makeInput({ tool_input: { taskId: "C1", status: "completed" } });
    const result = ArchitectureEscalation.execute(input, deps) as any;
    expect(result.ok).toBe(true);
    expect(result.value.additionalContext).toBeUndefined();
  });

  it("output shape matches Claude Code expectations", () => {
    const deps = makeDeps();
    const result = ArchitectureEscalation.execute(makeInput(), deps) as any;
    const output = result.value;
    const json = JSON.stringify(output);
    const parsed = JSON.parse(json);
    expect(parsed.continue).toBe(true);
  });

  it("tracks different criteria independently", () => {
    const deps = makeDeps();
    const inputC1 = makeInput({ tool_input: { taskId: "C1", status: "in_progress" } });
    const inputC2 = makeInput({ tool_input: { taskId: "C2", status: "in_progress" } });

    // Push C1 past warn threshold
    for (let i = 0; i <= WARN_THRESHOLD; i++) {
      ArchitectureEscalation.execute(inputC1, deps);
    }

    // C2 should still be clean
    const result = ArchitectureEscalation.execute(inputC2, deps) as any;
    expect(result.ok).toBe(true);
    expect(result.value.additionalContext).toBeUndefined();
  });

  it("persists state across execute calls via deps.writeJson", () => {
    let writeCount = 0;
    const store = new Map<string, unknown>();
    const deps = makeDeps({
      fileExists: (path: string) => store.has(path),
      readJson: <T>(path: string) => {
        if (!store.has(path)) return { ok: false as const, error: { code: "FileNotFound", message: path } as any };
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
