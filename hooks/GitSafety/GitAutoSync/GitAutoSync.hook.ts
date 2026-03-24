#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { GitAutoSync } from "@hooks/hooks/GitSafety/GitAutoSync/GitAutoSync.contract";

if (import.meta.main) {
  runHook(GitAutoSync).catch(() => {
    process.exit(0);
  });
}
