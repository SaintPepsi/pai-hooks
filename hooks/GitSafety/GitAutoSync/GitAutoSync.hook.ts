#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { GitAutoSync } from "@hooks/hooks/GitSafety/GitAutoSync/GitAutoSync.contract";

if (import.meta.main) {
  runHook(GitAutoSync).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
