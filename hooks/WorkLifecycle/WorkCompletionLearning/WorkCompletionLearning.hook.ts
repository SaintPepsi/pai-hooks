#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { WorkCompletionLearning } from "@hooks/hooks/WorkLifecycle/WorkCompletionLearning/WorkCompletionLearning.contract";

if (import.meta.main) {
  runHook(WorkCompletionLearning).catch(() => {
    process.exit(0);
  });
}
