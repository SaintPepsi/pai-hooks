#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CodingStandardsAdvisor } from "@hooks/hooks/CodingStandards/CodingStandardsAdvisor/CodingStandardsAdvisor.contract";

if (import.meta.main) {
  runHook(CodingStandardsAdvisor).catch(() => {
    process.exit(0);
  });
}
