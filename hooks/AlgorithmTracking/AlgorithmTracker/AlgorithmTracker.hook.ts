#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { AlgorithmTracker } from "@hooks/hooks/AlgorithmTracking/AlgorithmTracker/AlgorithmTracker.contract";

if (import.meta.main) {
  runHook(AlgorithmTracker).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
