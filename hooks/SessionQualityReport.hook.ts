#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { SessionQualityReport } from "./contracts/SessionQualityReport";

if (import.meta.main) {
  runHook(SessionQualityReport).catch(() => {
    process.exit(0);
  });
}
