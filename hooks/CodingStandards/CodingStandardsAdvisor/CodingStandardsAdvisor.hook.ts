#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CodingStandardsAdvisor } from "@hooks/contracts/CodingStandardsAdvisor";

if (import.meta.main) {
  runHook(CodingStandardsAdvisor).catch(() => {
    process.exit(0);
  });
}
