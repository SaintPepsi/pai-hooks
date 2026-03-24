#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CodingStandardsAdvisor } from "@hooks/hooks/CodingStandards/CodingStandardsAdvisor/CodingStandardsAdvisor.contract";

if (import.meta.main) {
  runHook(CodingStandardsAdvisor).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
