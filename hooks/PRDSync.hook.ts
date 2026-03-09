#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { PRDSync } from "./contracts/PRDSync";

if (import.meta.main) {
  runHook(PRDSync).catch(() => {
    process.exit(0);
  });
}
