#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CodeQualityGuard } from "@hooks/hooks/CodeQualityPipeline/CodeQualityGuard/CodeQualityGuard.contract";

if (import.meta.main) {
  runHook(CodeQualityGuard).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
