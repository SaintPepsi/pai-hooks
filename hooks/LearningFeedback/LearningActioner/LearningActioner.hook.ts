#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { LearningActioner } from "@hooks/hooks/LearningFeedback/LearningActioner/LearningActioner.contract";

if (import.meta.main) {
  runHook(LearningActioner).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
