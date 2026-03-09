#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { CheckAlgorithmVersion } from "./contracts/CheckAlgorithmVersion";

if (import.meta.main) {
  runHook(CheckAlgorithmVersion).catch(() => {
    process.exit(0);
  });
}
