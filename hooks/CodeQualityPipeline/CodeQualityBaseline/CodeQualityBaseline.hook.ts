#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CodeQualityBaseline } from "@hooks/hooks/CodeQualityPipeline/CodeQualityBaseline/CodeQualityBaseline.contract";

if (import.meta.main) {
  runHook(CodeQualityBaseline).catch(() => {

    process.exit(0);
  });
}
