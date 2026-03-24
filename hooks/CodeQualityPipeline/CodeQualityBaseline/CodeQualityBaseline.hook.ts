#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CodeQualityBaseline } from "@hooks/hooks/CodeQualityPipeline/CodeQualityBaseline/CodeQualityBaseline.contract";

if (import.meta.main) {
  runHook(CodeQualityBaseline).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
