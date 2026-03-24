#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { StartupGreeting } from "@hooks/contracts/StartupGreeting";

if (import.meta.main) {
  runHook(StartupGreeting).catch(() => {
    process.exit(0);
  });
}
