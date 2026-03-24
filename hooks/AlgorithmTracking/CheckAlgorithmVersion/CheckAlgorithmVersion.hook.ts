#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CheckAlgorithmVersion } from "@hooks/hooks/AlgorithmTracking/CheckAlgorithmVersion/CheckAlgorithmVersion.contract";

if (import.meta.main) {
  runHook(CheckAlgorithmVersion).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
