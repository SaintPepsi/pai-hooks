#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { WorkCompletionLearning } from "./contracts/WorkCompletionLearning";

if (import.meta.main) {
  runHook(WorkCompletionLearning).catch(() => {
    process.exit(0);
  });
}
