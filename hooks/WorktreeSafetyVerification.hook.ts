#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { WorktreeSafetyVerification } from "./contracts/WorktreeSafetyVerification";

if (import.meta.main) {
  runHook(WorktreeSafetyVerification).catch(() => {

    process.exit(0);
  });
}
