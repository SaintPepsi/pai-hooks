#!/usr/bin/env bun
import { runHook } from "./core/runner";
import { SecurityValidator } from "./contracts/SecurityValidator";

if (import.meta.main) {
  runHook(SecurityValidator).catch(() => {

    process.exit(0);
  });
}
