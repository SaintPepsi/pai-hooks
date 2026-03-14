#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { WorkCompletionLearning } from "@hooks/contracts/WorkCompletionLearning";

if (import.meta.main) {
  runHook(WorkCompletionLearning).catch(() => {
    process.exit(0);
  });
}
