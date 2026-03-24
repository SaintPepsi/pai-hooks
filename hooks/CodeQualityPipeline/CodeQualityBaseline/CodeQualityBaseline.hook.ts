#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CodeQualityBaseline } from "@hooks/contracts/CodeQualityBaseline";

if (import.meta.main) {
  runHook(CodeQualityBaseline).catch(() => {

    process.exit(0);
  });
}
