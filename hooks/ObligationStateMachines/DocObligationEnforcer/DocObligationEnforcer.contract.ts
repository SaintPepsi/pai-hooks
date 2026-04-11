import { join } from "node:path";
import type { SyncHookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import type { SyncHookContract } from "@hooks/core/contract";
import type { ResultError } from "@hooks/core/error";
import { ok, type Result } from "@hooks/core/result";
import type { StopInput } from "@hooks/core/types/hook-inputs";
import {
  blockCountPath,
  buildBlockLimitReview,
  buildDocSuggestions,
  type DocObligationDeps,
  defaultDeps,
  MAX_BLOCKS,
  pendingPath,
  projectHasHook,
} from "@hooks/hooks/ObligationStateMachines/DocObligationStateMachine.shared";
import { pickNarrative } from "@hooks/lib/narrative-reader";

export const DocObligationEnforcer: SyncHookContract<StopInput, DocObligationDeps> = {
  name: "DocObligationEnforcer",
  event: "Stop",

  accepts(_input: StopInput): boolean {
    if (projectHasHook("DocObligationEnforcer")) return false;
    return true;
  },

  execute(input: StopInput, deps: DocObligationDeps): Result<SyncHookJSONOutput, ResultError> {
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
      deps.writeReview(reviewPath, buildBlockLimitReview(pending, blockCount));
      deps.removeFlag(flagFile);
      deps.removeFlag(countFile);
      deps.stderr(
        `[DocObligationEnforcer] Block limit (${MAX_BLOCKS}) reached for ${pending.length} file(s). Review written. Releasing session.`,
      );
      return ok({});
    }

    const opener = pickNarrative("DocObligationEnforcer", pending.length, import.meta.dir);
    const fileList = pending.map((f) => `  - ${f}`).join("\n");
    const suggestions = buildDocSuggestions(pending, deps);
    const reason = `${opener}\n\nModified files without documentation updates:\n${fileList}\n\n${suggestions}`;

    deps.writeBlockCount(countFile, blockCount + 1);
    deps.stderr(
      `[DocObligationEnforcer] Block ${blockCount + 1}/${MAX_BLOCKS}: ${pending.length} file(s) modified without documentation updates`,
    );

    // R5: Stop is a NonHookSpecificEvent — block goes via top-level decision/reason,
    // NOT nested under hookSpecificOutput. First R5 site on branch.
    return ok({ decision: "block", reason });
  },

  defaultDeps,
};
