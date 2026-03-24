#!/usr/bin/env bun
/**
 * CronFire Hook Shell — runs CronFireContract through the standard runner pipeline.
 *
 * @see /Users/ian.hogers/.claude/pai-hooks/hooks/CronStatusLine/CronFire/CronFire.contract.ts
 */

import { runHook } from "@hooks/core/runner";
import { CronFireContract } from "@hooks/hooks/CronStatusLine/CronFire/CronFire.contract";

if (import.meta.main) {
  runHook(CronFireContract).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
