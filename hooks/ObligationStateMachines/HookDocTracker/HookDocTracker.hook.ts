#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { HookDocTracker } from "@hooks/hooks/ObligationStateMachines/HookDocTracker/HookDocTracker.contract";

if (import.meta.main) {
  runHook(HookDocTracker).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
