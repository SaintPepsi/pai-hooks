#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { StopOrchestrator } from "@hooks/hooks/StopOrchestrator/StopOrchestrator/StopOrchestrator.contract";

if (import.meta.main) {
  runHook(StopOrchestrator).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
