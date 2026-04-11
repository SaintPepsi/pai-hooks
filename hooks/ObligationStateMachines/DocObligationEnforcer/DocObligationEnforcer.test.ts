import { describe, expect, test } from "bun:test";
import type { StopInput } from "@hooks/core/types/hook-inputs";
import type { DocObligationDeps } from "@hooks/hooks/ObligationStateMachines/DocObligationStateMachine.shared";
import {
  getReasonFromBlock,
  isSilentNoOp,
} from "@hooks/hooks/ObligationStateMachines/test-helpers";
import { DocObligationEnforcer } from "./DocObligationEnforcer.contract";

const mockInput: StopInput = {
  hook_type: "Stop",
  session_id: "test-session-123",
};

function makeDeps(overrides: Partial<DocObligationDeps> = {}): DocObligationDeps {
  return {
    stateDir: "/tmp/test-state",
    fileExists: () => true,
    readPending: () => ["src/module.ts"],
    writeBlockCount: () => {},
    readBlockCount: () => 0,
    removeFlag: () => {},
    writeReview: () => {},
    writePending: () => {},
    stderr: () => {},
    ...overrides,
  };
}

describe("DocObligationEnforcer", () => {
  test("has correct name and event", () => {
    expect(DocObligationEnforcer.name).toBe("DocObligationEnforcer");
    expect(DocObligationEnforcer.event).toBe("Stop");
  });

  test("returns silent when no flag file", () => {
    const deps = makeDeps({ fileExists: () => false });
    const result = DocObligationEnforcer.execute(mockInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(isSilentNoOp(result.value)).toBe(true);
  });

  test("returns silent when pending list is empty", () => {
    const deps = makeDeps({ readPending: () => [] });
    const result = DocObligationEnforcer.execute(mockInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(isSilentNoOp(result.value)).toBe(true);
  });

  test("blocks when pending files exist and under block limit", () => {
    const result = DocObligationEnforcer.execute(mockInput, makeDeps());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const reason = getReasonFromBlock(result.value);
      expect(reason).toBeDefined();
      expect(reason ?? "").toContain("src/module.ts");
    }
  });

  test("increments block count", () => {
    let writtenCount = -1;
    const deps = makeDeps({
      readBlockCount: () => 0,
      writeBlockCount: (_path, count) => {
        writtenCount = count;
      },
    });
    DocObligationEnforcer.execute(mockInput, deps);
    expect(writtenCount).toBe(1);
  });

  test("releases at max blocks and writes review", () => {
    let reviewWritten = false;
    let flagRemoved = false;
    const deps = makeDeps({
      readBlockCount: () => 1, // MAX_BLOCKS is 1
      writeReview: () => {
        reviewWritten = true;
      },
      removeFlag: () => {
        flagRemoved = true;
      },
    });
    const result = DocObligationEnforcer.execute(mockInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(isSilentNoOp(result.value)).toBe(true);
    expect(reviewWritten).toBe(true);
    expect(flagRemoved).toBe(true);
  });
});
