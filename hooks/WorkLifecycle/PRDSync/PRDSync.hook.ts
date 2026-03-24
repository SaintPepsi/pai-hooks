#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { PRDSync } from "@hooks/hooks/WorkLifecycle/PRDSync/PRDSync.contract";

if (import.meta.main) {
  runHook(PRDSync).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
