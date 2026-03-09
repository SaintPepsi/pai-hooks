#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { TestObligationTracker } from "@hooks/contracts/TestObligationStateMachine";

if (import.meta.main) {
  runHook(TestObligationTracker).catch(() => {
    process.exit(0);
  });
}
