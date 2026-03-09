#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { TestObligationEnforcer } from "@hooks/contracts/TestObligationStateMachine";

if (import.meta.main) {
  runHook(TestObligationEnforcer).catch(() => {
    process.exit(0);
  });
}
