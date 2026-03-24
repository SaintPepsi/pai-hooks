#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CodingStandardsEnforcer } from "@hooks/contracts/CodingStandardsEnforcer";

if (import.meta.main) {
  runHook(CodingStandardsEnforcer).catch(() => {
    process.exit(0);
  });
}
