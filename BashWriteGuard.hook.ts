#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { BashWriteGuard } from "@hooks/contracts/BashWriteGuard";

if (import.meta.main) {
  runHook(BashWriteGuard).catch(() => {
    process.exit(0);
  });
}
