#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { AutoWorkCreation } from "@hooks/hooks/WorkLifecycle/AutoWorkCreation/AutoWorkCreation.contract";

if (import.meta.main) {
  runHook(AutoWorkCreation).catch(() => {
    process.exit(0);
  });
}
