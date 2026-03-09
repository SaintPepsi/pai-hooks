#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { CodingStandardsEnforcer } from "./contracts/CodingStandardsEnforcer";

if (import.meta.main) {
  runHook(CodingStandardsEnforcer).catch(() => {
    process.exit(0);
  });
}
