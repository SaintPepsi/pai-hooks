#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { AlgorithmTracker } from "@hooks/contracts/AlgorithmTracker";

if (import.meta.main) {
  runHook(AlgorithmTracker).catch(() => {

    process.exit(0);
  });
}
