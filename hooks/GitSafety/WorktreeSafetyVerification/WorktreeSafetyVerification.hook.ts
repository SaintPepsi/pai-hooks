#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { WorktreeSafetyVerification } from "@hooks/hooks/GitSafety/WorktreeSafetyVerification/WorktreeSafetyVerification.contract";

if (import.meta.main) {
  runHook(WorktreeSafetyVerification).catch(() => {

    process.exit(0);
  });
}
