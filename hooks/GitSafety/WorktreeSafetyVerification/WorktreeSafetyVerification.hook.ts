#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { WorktreeSafetyVerification } from "@hooks/hooks/GitSafety/WorktreeSafetyVerification/WorktreeSafetyVerification.contract";

if (import.meta.main) {
  runHook(WorktreeSafetyVerification).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
