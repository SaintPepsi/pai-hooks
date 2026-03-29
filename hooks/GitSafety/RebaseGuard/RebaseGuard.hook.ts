#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { RebaseGuard } from "@hooks/hooks/GitSafety/RebaseGuard/RebaseGuard.contract";

if (import.meta.main) {
  runHook(RebaseGuard).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
