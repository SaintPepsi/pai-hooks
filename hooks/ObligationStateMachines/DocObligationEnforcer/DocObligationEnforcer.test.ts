import { describe, expect, test } from "bun:test";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { StopInput } from "@hooks/core/types/hook-inputs";
import type { DocObligationDeps } from "@hooks/hooks/ObligationStateMachines/DocObligationStateMachine.shared";
import { DocObligationEnforcer } from "./DocObligationEnforcer.contract";

/** Narrow SyncHookJSONOutput for Stop block reason (R5: top-level decision/reason). */
function getBlockReason(output: SyncHookJSONOutput): string | undefined {
  if ("decision" in output && output.decision === "block") {
    return "reason" in output ? output.reason : undefined;
  }
  return undefined;
}

/** True when output has no decision and no hookSpecificOutput (R8 silent skip). */
function isSilent(output: SyncHookJSONOutput): boolean {
  return !("decision" in output) && !output.hookSpecificOutput;
}

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
    if (result.ok) expect(isSilent(result.value)).toBe(true);
  });

  test("returns silent when pending list is empty", () => {
    const deps = makeDeps({ readPending: () => [] });
    const result = DocObligationEnforcer.execute(mockInput, deps);
    expect(result.ok).toBe(true);
    if (result.ok) expect(isSilent(result.value)).toBe(true);
  });

  test("blocks when pending files exist and under block limit", () => {
    const result = DocObligationEnforcer.execute(mockInput, makeDeps());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const reason = getBlockReason(result.value);
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
    if (result.ok) expect(isSilent(result.value)).toBe(true);
    expect(reviewWritten).toBe(true);
    expect(flagRemoved).toBe(true);
  });
});
