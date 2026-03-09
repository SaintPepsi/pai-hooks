#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { LearningActioner } from "./contracts/LearningActioner";

if (import.meta.main) {
  runHook(LearningActioner).catch(() => {
    process.exit(0);
  });
}
