#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CronPrune } from "@hooks/hooks/CronStatusLine/CronPrune/CronPrune.contract";

if (import.meta.main) {
  runHook(CronPrune).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
