#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { SecurityValidator } from "@hooks/hooks/SecurityValidator/SecurityValidator/SecurityValidator.contract";

if (import.meta.main) {
  runHook(SecurityValidator).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
