#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CronDeleteContract } from "@hooks/hooks/CronStatusLine/CronDelete/CronDelete.contract";

if (import.meta.main) {
  runHook(CronDeleteContract).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
