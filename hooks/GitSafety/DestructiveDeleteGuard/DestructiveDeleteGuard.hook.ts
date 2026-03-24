#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { DestructiveDeleteGuard } from "@hooks/hooks/GitSafety/DestructiveDeleteGuard/DestructiveDeleteGuard.contract";

if (import.meta.main) {
  runHook(DestructiveDeleteGuard).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
