#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { CodingStandardsAdvisor } from "./contracts/CodingStandardsAdvisor";

if (import.meta.main) {
  runHook(CodingStandardsAdvisor).catch(() => {
    process.exit(0);
  });
}
