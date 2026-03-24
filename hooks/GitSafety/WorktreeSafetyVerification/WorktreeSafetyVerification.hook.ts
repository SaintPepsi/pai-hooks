#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { WorktreeSafetyVerification } from "@hooks/contracts/WorktreeSafetyVerification";

if (import.meta.main) {
  runHook(WorktreeSafetyVerification).catch(() => {

    process.exit(0);
  });
}
