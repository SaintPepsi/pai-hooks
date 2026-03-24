#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { ModeAnalytics } from "@hooks/hooks/IdentityBranding/ModeAnalytics/ModeAnalytics.contract";

if (import.meta.main) {
  runHook(ModeAnalytics).catch(() => {
    process.exit(0);
  });
}
