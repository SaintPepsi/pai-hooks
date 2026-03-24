#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { TestObligationTracker } from "@hooks/hooks/ObligationStateMachines/TestObligationTracker/TestObligationTracker.contract";

if (import.meta.main) {
  runHook(TestObligationTracker).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
