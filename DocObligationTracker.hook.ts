#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { DocObligationTracker } from "@hooks/contracts/DocObligationStateMachine";

if (import.meta.main) {
  runHook(DocObligationTracker).catch(() => {
    process.exit(0);
  });
}
