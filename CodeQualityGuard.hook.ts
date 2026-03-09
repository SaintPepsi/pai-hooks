#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { CodeQualityGuard } from "./contracts/CodeQualityGuard";

if (import.meta.main) {
  runHook(CodeQualityGuard).catch(() => {

    process.exit(0);
  });
}
