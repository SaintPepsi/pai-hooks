#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { AlgorithmTracker } from "./contracts/AlgorithmTracker";

if (import.meta.main) {
  runHook(AlgorithmTracker).catch(() => {

    process.exit(0);
  });
}
