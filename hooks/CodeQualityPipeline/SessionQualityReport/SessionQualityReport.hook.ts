#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { SessionQualityReport } from "@hooks/hooks/CodeQualityPipeline/SessionQualityReport/SessionQualityReport.contract";

if (import.meta.main) {
  runHook(SessionQualityReport).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
