#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { BashWriteGuard } from "@hooks/hooks/CodingStandards/BashWriteGuard/BashWriteGuard.contract";

if (import.meta.main) {
  runHook(BashWriteGuard).catch(() => {
    process.exit(0);
  });
}
