#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { GitAutoSync } from "./contracts/GitAutoSync";

if (import.meta.main) {
  runHook(GitAutoSync).catch(() => {
    process.exit(0);
  });
}
