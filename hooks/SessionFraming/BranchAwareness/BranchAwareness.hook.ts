#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { BranchAwareness } from "@hooks/hooks/SessionFraming/BranchAwareness/BranchAwareness.contract";

if (import.meta.main) {
  runHook(BranchAwareness).catch(() => {
    process.exit(0);
  });
}
