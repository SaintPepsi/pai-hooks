#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CodeQualityGuard } from "@hooks/contracts/CodeQualityGuard";

if (import.meta.main) {
  runHook(CodeQualityGuard).catch(() => {

    process.exit(0);
  });
}
