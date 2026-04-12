import { describe, expect, test } from "bun:test";
import type { StopInput } from "@hooks/core/types/hook-inputs";
import type { TestObligationDeps } from "@hooks/hooks/ObligationStateMachines/TestObligationStateMachine.shared";
import { getReasonFromBlock, isBareNoOp } from "@hooks/hooks/ObligationStateMachines/test-helpers";
import { TestObligationEnforcer } from "./TestObligationEnforcer.contract";

const mockInput: StopInput = {
  hook_type: "Stop",
  session_id: "test-session-123",
};

function makeDeps(overrides: Partial<TestObligationDeps> = {}): TestObligationDeps {
  return {
    stateDir: "/tmp/test-state",
    fileExists: () => true,
    readPending: () => ["src/module.ts"],
    writePending: () => {},
    removeFlag: () => {},
    readBlockCount: () => 0,
    writeBlockCount: () => {},
    writeReview: () => {},
    stderr: () => {},
    ...overrides,
  };
}

describe("TestObligationEnforcer", () => {
  test("has correct name and event", () => {
    expect(TestObligationEnforcer.name).toBe("TestObligationEnforcer");
    expect(TestObligationEnforcer.event).toBe("Stop");
  });

  test("accepts all inputs", () => {
    expect(TestObligationEnforcer.accepts(mockInput)).toBe(true);
  });

  test("returns silent when no flag file", () => {
    const deps = makeDeps({ fileExists: () => false });
    const result = TestObligationEnforcer.execute(mockInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(isBareNoOp(result.value)).toBe(true);
  });

  test("returns silent when pending list is empty", () => {
    const deps = makeDeps({ readPending: () => [] });
    const result = TestObligationEnforcer.execute(mockInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(isBareNoOp(result.value)).toBe(true);
  });

  test("blocks with 'write tests' for files without test files", () => {
    const deps = makeDeps({
      readPending: () => ["src/new-module.ts"],
      fileExists: (path) => {
        // Flag file exists, but no test file for src/new-module.ts
        if (path.endsWith(".test.ts") || path.endsWith(".spec.ts")) return false;
        if (path.endsWith("Test.php") || path.endsWith(".test.tsx")) return false;
        if (path.endsWith(".test.js") || path.endsWith(".spec.js")) return false;
        return true;
      },
    });
    const result = TestObligationEnforcer.execute(mockInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const reason = getReasonFromBlock(result.value);
      expect(reason).toBeDefined();
      expect(reason ?? "").toContain("Write and run tests");
      expect(reason ?? "").toContain("src/new-module.ts");
    }
  });

  test("blocks with 'run tests' for files with existing test files", () => {
    const deps = makeDeps({
      readPending: () => ["src/existing.ts"],
      fileExists: () => true, // both flag and test file exist
    });
    const result = TestObligationEnforcer.execute(mockInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const reason = getReasonFromBlock(result.value);
      expect(reason).toBeDefined();
      expect(reason ?? "").toContain("Run existing tests");
    }
  });

  test("increments block count", () => {
    let writtenCount = -1;
    const deps = makeDeps({
      writeBlockCount: (_path, count) => {
        writtenCount = count;
      },
    });
    TestObligationEnforcer.execute(mockInput, deps);
    expect(writtenCount).toBe(1);
  });

  test("releases at MAX_BLOCKS (2) and writes review", () => {
    let reviewWritten = false;
    let flagRemoved = false;
    const deps = makeDeps({
      readBlockCount: () => 2,
      writeReview: () => {
        reviewWritten = true;
      },
      removeFlag: () => {
        flagRemoved = true;
      },
    });
    const result = TestObligationEnforcer.execute(mockInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(isBareNoOp(result.value)).toBe(true);
    expect(reviewWritten).toBe(true);
    expect(flagRemoved).toBe(true);
  });
});
