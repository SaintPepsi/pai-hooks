#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { PRDSync } from "@hooks/hooks/WorkLifecycle/PRDSync/PRDSync.contract";

if (import.meta.main) {
  runHook(PRDSync).catch(() => {
    process.exit(0);
  });
}
