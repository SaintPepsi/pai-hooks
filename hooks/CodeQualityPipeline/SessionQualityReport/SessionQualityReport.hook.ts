#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { SessionQualityReport } from "@hooks/contracts/SessionQualityReport";

if (import.meta.main) {
  runHook(SessionQualityReport).catch(() => {
    process.exit(0);
  });
}
