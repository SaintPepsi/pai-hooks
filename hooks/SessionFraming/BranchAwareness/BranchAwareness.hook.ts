#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { BranchAwareness } from "@hooks/hooks/SessionFraming/BranchAwareness/BranchAwareness.contract";

if (import.meta.main) {
  runHook(BranchAwareness).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
