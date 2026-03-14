#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { StopOrchestrator } from "@hooks/contracts/StopOrchestrator";

if (import.meta.main) {
  runHook(StopOrchestrator).catch(() => {
    process.exit(0);
  });
}
