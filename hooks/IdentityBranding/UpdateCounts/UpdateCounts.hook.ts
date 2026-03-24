#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { UpdateCounts } from "@hooks/hooks/IdentityBranding/UpdateCounts/UpdateCounts.contract";

if (import.meta.main) {
  runHook(UpdateCounts).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
