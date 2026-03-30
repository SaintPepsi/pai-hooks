import { describe, expect, it } from "bun:test";
import { defaultDedupDeps, isDuplicate, stableHash, type DedupDeps } from "@hooks/core/dedup";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeToolInput(toolName: string, toolInput: Record<string, string> = {}): ToolHookInput {
  return { session_id: "test-sess", tool_name: toolName, tool_input: toolInput };
}

const mockDeps = (overrides: Partial<DedupDeps> = {}): DedupDeps => ({
  ensureDir: () => true,
  tryClaimLock: () => true,
  ...overrides,
});

// ─── stableHash ─────────────────────────────────────────────────────────────

describe("stableHash", () => {
  it("produces same hash for same object regardless of key order", () => {
    const a: ToolHookInput = { session_id: "s1", tool_name: "Bash", tool_input: { z: "1", a: "2" } };
    const b: ToolHookInput = { session_id: "s1", tool_name: "Bash", tool_input: { a: "2", z: "1" } };
    expect(stableHash("hook", a)).toBe(stableHash("hook", b));
  });

  it("produces different hash for different hook names", () => {
    const input = makeToolInput("Bash");
    expect(stableHash("HookA", input)).not.toBe(stableHash("HookB", input));
  });

  it("produces different hash for different inputs", () => {
    const a = makeToolInput("Bash");
    const b = makeToolInput("Edit");
    expect(stableHash("Hook", a)).not.toBe(stableHash("Hook", b));
  });

  it("handles nested objects with stable ordering", () => {
    const a: ToolHookInput = { session_id: "s1", tool_name: "Write", tool_input: { file_path: "/a", content: "x" } };
    const b: ToolHookInput = { session_id: "s1", tool_name: "Write", tool_input: { content: "x", file_path: "/a" } };
    expect(stableHash("Hook", a)).toBe(stableHash("Hook", b));
  });
});

// ─── isDuplicate ────────────────────────────────────────────────────────────

describe("isDuplicate", () => {
  it("returns false on first invocation (lock acquired)", () => {
    let created = false;
    const deps = mockDeps({
      tryClaimLock: () => {
        created = true;
        return true;
      },
    });

    const result = isDuplicate("TestHook", "sess-1", makeToolInput("Bash"), deps);
    expect(result).toBe(false);
    expect(created).toBe(true);
  });

  it("returns true on second invocation (lock already exists)", () => {
    const deps = mockDeps({ tryClaimLock: () => false });

    const result = isDuplicate("TestHook", "sess-1", makeToolInput("Bash"), deps);
    expect(result).toBe(true);
  });

  it("different inputs produce different lock paths (both fire)", () => {
    const lockPaths: string[] = [];
    const deps = mockDeps({
      tryClaimLock: (path: string) => {
        lockPaths.push(path);
        return true;
      },
    });

    isDuplicate("TestHook", "sess-1", makeToolInput("Bash"), deps);
    isDuplicate("TestHook", "sess-1", makeToolInput("Edit"), deps);
    expect(lockPaths[0]).not.toBe(lockPaths[1]);
  });

  it("same input produces same lock path", () => {
    const lockPaths: string[] = [];
    const deps = mockDeps({
      tryClaimLock: (path: string) => {
        lockPaths.push(path);
        return true;
      },
    });

    const input = makeToolInput("Bash", { command: "ls" });
    isDuplicate("TestHook", "sess-1", input, deps);
    isDuplicate("TestHook", "sess-1", input, deps);
    expect(lockPaths[0]).toBe(lockPaths[1]);
  });

  it("lock path includes session_id for scoping", () => {
    let lockPath = "";
    const deps = mockDeps({
      tryClaimLock: (path: string) => {
        lockPath = path;
        return true;
      },
    });

    isDuplicate("TestHook", "my-session-123", makeToolInput("Bash"), deps);
    expect(lockPath).toContain("my-session-123");
  });

  it("lock path is under /tmp/pai-dedup/", () => {
    let lockPath = "";
    const deps = mockDeps({
      tryClaimLock: (path: string) => {
        lockPath = path;
        return true;
      },
    });

    isDuplicate("TestHook", "sess-1", makeToolInput("Bash"), deps);
    expect(lockPath).toContain("/tmp/pai-dedup/");
  });

  it("calls ensureDir before tryClaimLock", () => {
    const callOrder: string[] = [];
    const deps: DedupDeps = {
      ensureDir: () => {
        callOrder.push("ensureDir");
        return true;
      },
      tryClaimLock: () => {
        callOrder.push("tryClaimLock");
        return true;
      },
    };

    isDuplicate("TestHook", "sess-1", makeToolInput("Bash"), deps);
    expect(callOrder).toEqual(["ensureDir", "tryClaimLock"]);
  });

  it("fails open when ensureDir returns false", () => {
    const deps = mockDeps({ ensureDir: () => false });
    const result = isDuplicate("TestHook", "sess-1", makeToolInput("Bash"), deps);
    expect(result).toBe(false);
  });
});

// ─── defaultDedupDeps ──────────────────────────────────────────────────────

describe("defaultDedupDeps", () => {
  it("ensureDir returns true for /tmp", () => {
    const deps = defaultDedupDeps();
    expect(deps.ensureDir("/tmp")).toBe(true);
  });

  it("tryClaimLock returns true for a new lock file", () => {
    const deps = defaultDedupDeps();
    const lockPath = `/tmp/pai-dedup-test-${Date.now()}-${Math.random().toString(36).slice(2)}.lock`;
    expect(deps.tryClaimLock(lockPath)).toBe(true);
    // Cleanup
    require("fs").unlinkSync(lockPath);
  });

  it("tryClaimLock returns false for an existing lock file", () => {
    const deps = defaultDedupDeps();
    const lockPath = `/tmp/pai-dedup-test-dup-${Date.now()}.lock`;
    deps.tryClaimLock(lockPath); // first claim
    expect(deps.tryClaimLock(lockPath)).toBe(false); // duplicate
    require("fs").unlinkSync(lockPath);
  });
});
