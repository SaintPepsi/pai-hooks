#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { StopOrchestrator } from "./contracts/StopOrchestrator";

if (import.meta.main) {
  runHook(StopOrchestrator).catch(() => {
    process.exit(0);
  });
}
