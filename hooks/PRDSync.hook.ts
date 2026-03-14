#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { PRDSync } from "@hooks/contracts/PRDSync";

if (import.meta.main) {
  runHook(PRDSync).catch(() => {
    process.exit(0);
  });
}
