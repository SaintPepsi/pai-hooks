#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { StartupGreeting } from "./contracts/StartupGreeting";

if (import.meta.main) {
  runHook(StartupGreeting).catch(() => {
    process.exit(0);
  });
}
