#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CodingStandardsEnforcer } from "@hooks/hooks/CodingStandards/CodingStandardsEnforcer/CodingStandardsEnforcer.contract";

if (import.meta.main) {
  runHook(CodingStandardsEnforcer).catch(() => {
    process.exit(0);
  });
}
