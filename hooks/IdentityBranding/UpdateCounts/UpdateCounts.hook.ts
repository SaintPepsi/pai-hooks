#!/usr/bin/env bun
import { runHook } from "@hooks/core/runner";
import { UpdateCounts } from "@hooks/contracts/UpdateCounts";

if (import.meta.main) {
  runHook(UpdateCounts).catch(() => {
    process.exit(0);
  });
}
