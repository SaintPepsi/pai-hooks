#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { LearningActioner } from "@hooks/contracts/LearningActioner";

if (import.meta.main) {
  runHook(LearningActioner).catch(() => {
    process.exit(0);
  });
}
