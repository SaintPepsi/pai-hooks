import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { StopInput } from "@hooks/core/types/hook-inputs";
import {
  blockCountPath,
  buildBlockLimitReview,
  defaultDeps,
  hasTestFile,
  MAX_BLOCKS,
  pendingPath,
  type TestObligationDeps,
} from "@hooks/hooks/ObligationStateMachines/TestObligationStateMachine.shared";
import { pickNarrative } from "@hooks/lib/narrative-reader";

export const TestObligationEnforcer: SyncHookContract<StopInput, TestObligationDeps> = {
  name: "TestObligationEnforcer",
  event: "Stop",

  accepts(_input: StopInput): boolean {
    return true;
  },

  execute(input: StopInput, deps: TestObligationDeps): Result<SyncHookJSONOutput, ResultError> {
    const flagFile = pendingPath(deps.stateDir, input.session_id);

    if (!deps.fileExists(flagFile)) {
      return ok({});
    }

    const pending = deps.readPending(flagFile);
    if (pending.length === 0) {
      return ok({});
    }

    const countFile = blockCountPath(deps.stateDir, input.session_id);
    const blockCount = deps.readBlockCount(countFile);

    if (blockCount >= MAX_BLOCKS) {
      const reviewPath = join(deps.stateDir, `review-${input.session_id}.md`);
      const review = buildBlockLimitReview("test", pending, blockCount);
      deps.writeReview(reviewPath, review);
      deps.removeFlag(flagFile);
      deps.removeFlag(countFile);
      deps.stderr(
        `[TestObligationEnforcer] Block limit (${MAX_BLOCKS}) reached for ${pending.length} file(s). Review written. Releasing session.`,
      );
      return ok({});
    }

    const needsWriting: string[] = [];
    const needsRunning: string[] = [];

    for (const file of pending) {
      if (hasTestFile(file, deps.fileExists)) {
        needsRunning.push(file);
      } else {
        needsWriting.push(file);
      }
    }

    const opener = pickNarrative("TestObligationEnforcer", pending.length, import.meta.dir);
    const sections: string[] = [];

    if (needsWriting.length > 0) {
      const list = needsWriting.map((f) => `  - ${f}`).join("\n");
      sections.push(`Write and run tests for (no test file exists):\n${list}`);
    }

    if (needsRunning.length > 0) {
      const list = needsRunning.map((f) => `  - ${f}`).join("\n");
      sections.push(`Run existing tests for:\n${list}`);
    }

    const reason = `${opener}\n\n${sections.join("\n\n")}`;

    deps.writeBlockCount(countFile, blockCount + 1);
    deps.stderr(
      `[TestObligationEnforcer] Block ${blockCount + 1}/${MAX_BLOCKS}: ${pending.length} file(s) modified without tests`,
    );

    // R5: Stop is a NonHookSpecificEvent — block via top-level decision/reason.
    return ok({ decision: "block", reason });
  },

  defaultDeps,
};
