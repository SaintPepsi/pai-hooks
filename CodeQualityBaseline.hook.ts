#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { CodeQualityBaseline } from "./contracts/CodeQualityBaseline";

if (import.meta.main) {
  runHook(CodeQualityBaseline).catch(() => {

    process.exit(0);
  });
}
