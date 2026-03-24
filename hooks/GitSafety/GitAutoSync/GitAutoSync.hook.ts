#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { GitAutoSync } from "@hooks/contracts/GitAutoSync";

if (import.meta.main) {
  runHook(GitAutoSync).catch(() => {
    process.exit(0);
  });
}
