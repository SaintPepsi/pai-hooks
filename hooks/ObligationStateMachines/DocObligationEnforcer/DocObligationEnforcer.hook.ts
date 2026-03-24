#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { DocObligationEnforcer } from "@hooks/hooks/ObligationStateMachines/DocObligationEnforcer/DocObligationEnforcer.contract";

if (import.meta.main) {
  runHook(DocObligationEnforcer).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
