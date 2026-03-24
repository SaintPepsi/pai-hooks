#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { AutoWorkCreation } from "@hooks/contracts/AutoWorkCreation";

if (import.meta.main) {
  runHook(AutoWorkCreation).catch(() => {
    process.exit(0);
  });
}
