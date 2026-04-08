#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { SteeringRuleInjector } from "@hooks/hooks/SteeringRuleInjector/SteeringRuleInjector/SteeringRuleInjector.contract";

if (import.meta.main) {
  runHook(SteeringRuleInjector).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
