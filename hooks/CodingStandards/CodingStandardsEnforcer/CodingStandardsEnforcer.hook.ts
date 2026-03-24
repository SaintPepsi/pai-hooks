#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CodingStandardsEnforcer } from "@hooks/hooks/CodingStandards/CodingStandardsEnforcer/CodingStandardsEnforcer.contract";

if (import.meta.main) {
  runHook(CodingStandardsEnforcer).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
