#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CronCreateContract } from "@hooks/hooks/CronStatusLine/CronCreate/CronCreate.contract";

if (import.meta.main) {
  runHook(CronCreateContract).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
