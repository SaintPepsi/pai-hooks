#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { ModeAnalytics } from "@hooks/contracts/ModeAnalytics";

if (import.meta.main) {
  runHook(ModeAnalytics).catch(() => {
    process.exit(0);
  });
}
