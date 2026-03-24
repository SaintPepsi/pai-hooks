#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { DocObligationTracker } from "@hooks/hooks/ObligationStateMachines/DocObligationTracker/DocObligationTracker.contract";

if (import.meta.main) {
  runHook(DocObligationTracker).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
