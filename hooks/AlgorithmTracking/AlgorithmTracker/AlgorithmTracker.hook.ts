#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { AlgorithmTracker } from "@hooks/hooks/AlgorithmTracking/AlgorithmTracker/AlgorithmTracker.contract";

if (import.meta.main) {
  runHook(AlgorithmTracker).catch(() => {

    process.exit(0);
  });
}
