#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CronSessionEnd } from "@hooks/hooks/CronStatusLine/CronSessionEnd/CronSessionEnd.contract";

if (import.meta.main) {
  runHook(CronSessionEnd).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
