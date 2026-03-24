#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CheckAlgorithmVersion } from "@hooks/contracts/CheckAlgorithmVersion";

if (import.meta.main) {
  runHook(CheckAlgorithmVersion).catch(() => {
    process.exit(0);
  });
}
