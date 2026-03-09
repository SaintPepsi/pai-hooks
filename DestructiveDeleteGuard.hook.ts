#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { DestructiveDeleteGuard } from "@hooks/contracts/DestructiveDeleteGuard";

if (import.meta.main) {
  runHook(DestructiveDeleteGuard).catch(() => {
    process.exit(0);
  });
}
