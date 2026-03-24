#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { CheckVersion } from "@hooks/contracts/CheckVersion";

if (import.meta.main) {
  runHook(CheckVersion).catch(() => {
    process.exit(0);
  });
}
