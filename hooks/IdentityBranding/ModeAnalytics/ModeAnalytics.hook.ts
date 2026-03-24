#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { ModeAnalytics } from "@hooks/hooks/IdentityBranding/ModeAnalytics/ModeAnalytics.contract";

if (import.meta.main) {
  runHook(ModeAnalytics).catch((e) => {
    process.stderr.write(`[hook] fatal: ${e instanceof Error ? e.message : e}\n`);
    process.exit(0);
  });
}
