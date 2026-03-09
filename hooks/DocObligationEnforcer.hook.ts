#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { DocObligationEnforcer } from "@hooks/contracts/DocObligationStateMachine";

if (import.meta.main) {
  runHook(DocObligationEnforcer).catch(() => {
    process.exit(0);
  });
}
