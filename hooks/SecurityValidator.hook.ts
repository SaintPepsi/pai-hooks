#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { SecurityValidator } from "@hooks/contracts/SecurityValidator";

if (import.meta.main) {
  runHook(SecurityValidator).catch(() => {

    process.exit(0);
  });
}
