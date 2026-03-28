#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { HookDocEnforcer } from "@hooks/hooks/ObligationStateMachines/HookDocEnforcer/HookDocEnforcer.contract";

if (import.meta.main) {
  runHook(HookDocEnforcer).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
