#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { BashWriteGuard } from "@hooks/hooks/CodingStandards/BashWriteGuard/BashWriteGuard.contract";

if (import.meta.main) {
  runHook(BashWriteGuard).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
