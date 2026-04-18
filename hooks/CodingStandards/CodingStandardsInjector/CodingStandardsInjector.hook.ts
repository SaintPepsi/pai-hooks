#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CodingStandardsInjector } from "@hooks/hooks/CodingStandards/CodingStandardsInjector/CodingStandardsInjector.contract";

if (import.meta.main) {
  runHook(CodingStandardsInjector).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
