#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { LearningActioner } from "@hooks/hooks/LearningFeedback/LearningActioner/LearningActioner.contract";

if (import.meta.main) {
  runHook(LearningActioner).catch(() => {
    process.exit(0);
  });
}
